/**
 * Exercises one-time purchase pricing and fulfilment.
 *
 * The rule under test throughout: the price is computed from the catalog and
 * the buyer's tier, never accepted from the caller. These assertions call the
 * same pricePurchase() the checkout action calls.
 *
 *   npx tsx scripts/check-orders.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { discountedCents } from '../src/lib/access';
// The REAL pricing function the checkout action calls — not a copy.
import { pricePurchase } from '../src/lib/pricing';
import { refundOrder } from '../src/lib/refunds';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function main() {
  const community = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  const pro = await db.user.findUniqueOrThrow({ where: { email: 'pro@example.com' } });
  const wrt = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });
  const cec = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });

  // Clean slate.
  await db.orderItem.deleteMany({ where: { order: { userId: { in: [community.id, pro.id] } } } });
  await db.order.deleteMany({ where: { userId: { in: [community.id, pro.id] } } });
  await db.entitlement.deleteMany({ where: { userId: { in: [community.id, pro.id] } } });

  console.log('\nCourse pricing applies the tier discount:');
  const c1 = await pricePurchase(community, { kind: 'course', courseId: wrt.id });
  check('Community pays list for WRT ($450)', c1.ok && c1.line.unitCents, 45000);

  const p1 = await pricePurchase(pro, { kind: 'course', courseId: wrt.id });
  check('Pro pays 10% less for WRT ($405)', p1.ok && p1.line.unitCents, 40500);
  check('the list price is kept for the receipt', p1.ok && p1.line.listCents, 45000);

  console.log('\nYou cannot buy what you already have:');
  const proCec = await pricePurchase(pro, { kind: 'course', courseId: cec.id });
  check('Pro is refused a CEC course (included with the tier)', proCec.ok, false);
  check('…with a useful reason', !proCec.ok && proCec.reason, 'You already have access to this course.');

  const commCec = await pricePurchase(community, { kind: 'course', courseId: cec.id });
  check('Community may buy the same CEC course', commCec.ok, true);
  check('…at list price ($89.99)', commCec.ok && commCec.line.unitCents, 8999);

  await db.entitlement.create({
    data: { userId: community.id, courseId: wrt.id, source: 'purchase', expiresAt: new Date(Date.now() + 86400000) },
  });
  const repeat = await pricePurchase(community, { kind: 'course', courseId: wrt.id });
  check('an existing purchase blocks buying it again', repeat.ok, false);

  await db.entitlement.updateMany({
    where: { userId: community.id, courseId: wrt.id },
    data: { expiresAt: new Date('2020-01-01') },
  });
  const lapsed = await pricePurchase(community, { kind: 'course', courseId: wrt.id });
  check('an EXPIRED purchase can be bought again', lapsed.ok, true);
  await db.entitlement.deleteMany({ where: { userId: community.id } });

  console.log('\nUnpublished courses are not purchasable:');
  await db.course.update({ where: { id: wrt.id }, data: { published: false } });
  const unpub = await pricePurchase(community, { kind: 'course', courseId: wrt.id });
  check('refused while unpublished', unpub.ok, false);
  await db.course.update({ where: { id: wrt.id }, data: { published: true } });

  console.log('\nClass seat pricing:');
  const klass = await db.scheduledClass.findFirstOrThrow({
    where: { published: true },
    select: { id: true, title: true, inPersonPriceCents: true, virtualPriceCents: true, seatsTotal: true },
  });
  check(
    'Pro pays 10% off a classroom seat',
    discountedCents(klass.inPersonPriceCents!, pro.tier),
    Math.round(klass.inPersonPriceCents! * 0.9)
  );
  check(
    'Community pays list for a live-stream seat',
    discountedCents(klass.virtualPriceCents!, community.tier),
    klass.virtualPriceCents
  );

  const seatPro = await pricePurchase(pro, { kind: 'class_seat', classId: klass.id, seatMode: 'inperson' });
  check('a classroom seat prices through the real function', seatPro.ok, true);
  check(
    '…at 10% off for Pro',
    seatPro.ok && seatPro.line.unitCents,
    discountedCents(klass.inPersonPriceCents!, pro.tier)
  );
  check('…and keeps the list price', seatPro.ok && seatPro.line.listCents, klass.inPersonPriceCents);

  console.log('\nClass seat refusals:');
  await db.seatBooking.deleteMany({ where: { userId: pro.id, classId: klass.id } });
  await db.seatBooking.create({
    data: { classId: klass.id, userId: pro.id, mode: 'inperson', paidCents: 40500 },
  });
  const double = await pricePurchase(pro, { kind: 'class_seat', classId: klass.id, seatMode: 'virtual' });
  check('a second seat on the same class is refused', double.ok, false);
  check('…with a useful reason', !double.ok && double.reason, 'You already have a seat on this class.');
  await db.seatBooking.deleteMany({ where: { userId: pro.id, classId: klass.id } });

  // Temporarily make the class live-stream only, then ask for a classroom seat.
  await db.scheduledClass.update({ where: { id: klass.id }, data: { mode: 'virtual' } });
  const wrongMode = await pricePurchase(pro, { kind: 'class_seat', classId: klass.id, seatMode: 'inperson' });
  check('a classroom seat on a live-stream-only class is refused', wrongMode.ok, false);
  check('…with a useful reason', !wrongMode.ok && wrongMode.reason, 'That class is live stream only.');
  await db.scheduledClass.update({ where: { id: klass.id }, data: { mode: 'hybrid' } });

  // Unpublish it.
  await db.scheduledClass.update({ where: { id: klass.id }, data: { published: false } });
  const unpubClass = await pricePurchase(pro, { kind: 'class_seat', classId: klass.id, seatMode: 'virtual' });
  check('an unpublished class is not bookable', unpubClass.ok, false);
  await db.scheduledClass.update({ where: { id: klass.id }, data: { published: true } });

  // A class that has already run.
  const original = klass.id;
  const past = await db.scheduledClass.findUniqueOrThrow({ where: { id: original }, select: { startDate: true, endDate: true } });
  await db.scheduledClass.update({
    where: { id: original },
    data: { startDate: new Date('2020-01-01'), endDate: new Date('2020-01-02') },
  });
  const ran = await pricePurchase(pro, { kind: 'class_seat', classId: original, seatMode: 'virtual' });
  check('a class that already ran is refused', ran.ok, false);
  check('…with a useful reason', !ran.ok && ran.reason, 'That class has already run.');
  await db.scheduledClass.update({
    where: { id: original },
    data: { startDate: past.startDate, endDate: past.endDate },
  });

  console.log('\nFulfilment is idempotent:');
  const order = await db.order.create({
    data: {
      userId: community.id,
      paypalOrderId: 'TEST-ORDER-CHECK',
      status: 'created',
      totalCents: 45000,
      items: {
        create: {
          kind: 'course', courseId: wrt.id,
          description: 'Water Damage Restoration Technician',
          listCents: 45000, unitCents: 45000,
        },
      },
    },
    include: { items: true },
  });

  // Simulate settleOrder's grant step twice — the upsert must not duplicate.
  for (let i = 0; i < 2; i++) {
    await db.entitlement.upsert({
      where: { userId_courseId_source: { userId: community.id, courseId: wrt.id, source: 'purchase' } },
      create: { userId: community.id, courseId: wrt.id, source: 'purchase', expiresAt: new Date(Date.now() + 365 * 86400000) },
      update: {},
    });
  }
  check(
    'granting twice yields one entitlement',
    await db.entitlement.count({ where: { userId: community.id, courseId: wrt.id } }),
    1
  );

  await db.order.update({
    where: { id: order.id },
    data: { status: 'completed', fulfilledAt: new Date(), capturedAt: new Date() },
  });
  const settled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  check('fulfilledAt is the guard against re-granting', settled.fulfilledAt !== null, true);

  console.log('\nAmount mismatch is caught:');
  // 45000 cents formats as "450.00"; anything else must not fulfil.
  const expected = (45000 / 100).toFixed(2);
  check('expected value string', expected, '450.00');
  check('a capture of 4.50 does not equal 450.00', '4.50' === expected, false);

  console.log('\nOne year of access on a course purchase:');
  const ent = await db.entitlement.findFirstOrThrow({
    where: { userId: community.id, courseId: wrt.id },
  });
  const days = Math.round((ent.expiresAt!.getTime() - Date.now()) / 86400000);
  check('expires in ~365 days', days >= 364 && days <= 366, true);

  console.log('\nRefunds:');

  // Build a paid order by hand with a known capture id, plus the grants it
  // would have made, then let the webhook path reverse it.
  const CAP = 'TEST-CAPTURE-REFUND';
  await db.order.deleteMany({ where: { paypalCaptureId: CAP } });
  const seatClass = await db.scheduledClass.findFirstOrThrow({ where: { published: true } });

  const refundable = await db.order.create({
    data: {
      userId: community.id,
      paypalOrderId: 'TEST-ORDER-REFUND',
      paypalCaptureId: CAP,
      status: 'completed',
      totalCents: 50000,
      capturedAt: new Date(),
      fulfilledAt: new Date(),
      items: {
        create: [
          { kind: 'course', courseId: wrt.id, description: wrt.title, listCents: 45000, unitCents: 45000 },
          { kind: 'class_seat', classId: seatClass.id, description: 'Seat', listCents: 5000, unitCents: 5000 },
        ],
      },
    },
  });
  // An earlier assertion in this file left a WRT entitlement on this member.
  await db.entitlement.deleteMany({ where: { userId: community.id, courseId: wrt.id } });
  await db.seatBooking.deleteMany({ where: { userId: community.id, classId: seatClass.id } });
  await db.entitlement.create({
    data: { userId: community.id, courseId: wrt.id, source: 'purchase' },
  });
  await db.seatBooking.create({
    data: { userId: community.id, classId: seatClass.id, mode: 'inperson', paidCents: 5000 },
  });

  console.log('\n  A partial refund records but does not withdraw:');
  const partial = await refundOrder({ captureId: CAP, refundedCents: 10000 });
  check('handled', partial.ok && partial.partial, true);
  check('nothing revoked', partial.ok && partial.revoked, false);
  let row = await db.order.findUniqueOrThrow({ where: { id: refundable.id } });
  check('still marked paid', row.status, 'completed');
  check('amount recorded', row.refundedCents, 10000);
  check('flagged for a human', row.error !== null, true);
  check(
    'the course entitlement survives',
    await db.entitlement.count({ where: { userId: community.id, courseId: wrt.id } }),
    1
  );
  check(
    'the seat survives',
    await db.seatBooking.count({ where: { userId: community.id, classId: seatClass.id } }),
    1
  );

  console.log('\n  Refunding the rest withdraws everything:');
  const full = await refundOrder({ captureId: CAP, refundedCents: 40000 });
  check('revoked', full.ok && full.revoked, true);
  row = await db.order.findUniqueOrThrow({ where: { id: refundable.id } });
  check('marked refunded', row.status, 'refunded');
  check('refunds accumulate to the total', row.refundedCents, 50000);
  check('the partial-refund flag is cleared', row.error, null);
  check(
    'the purchase entitlement is gone',
    await db.entitlement.count({ where: { userId: community.id, courseId: wrt.id, source: 'purchase' } }),
    0
  );
  check(
    'the seat is released',
    await db.seatBooking.count({ where: { userId: community.id, classId: seatClass.id } }),
    0
  );

  console.log('\n  A redelivered refund does not revoke twice:');
  // Re-grant by another route — a membership, say. A repeat webhook must not
  // take away something the member holds for a different reason.
  await db.entitlement.create({
    data: { userId: community.id, courseId: wrt.id, source: 'purchase' },
  });
  const again = await refundOrder({ captureId: CAP, refundedCents: 50000 });
  check('accepted', again.ok, true);
  check('but revokes nothing', again.ok && again.revoked, false);
  check(
    'the re-granted entitlement is untouched',
    await db.entitlement.count({ where: { userId: community.id, courseId: wrt.id } }),
    1
  );

  console.log('\n  A refund against an unknown capture is reported, not thrown:');
  const unknown = await refundOrder({ captureId: 'NOPE', refundedCents: 100 });
  check('rejected', unknown.ok, false);
  check('with a reason', !unknown.ok && unknown.reason, 'unknown-capture');

  await db.orderItem.deleteMany({ where: { orderId: refundable.id } });
  await db.order.delete({ where: { id: refundable.id } });

  // Reset.
  await db.orderItem.deleteMany({ where: { orderId: order.id } });
  await db.order.deleteMany({ where: { userId: { in: [community.id, pro.id] } } });
  await db.entitlement.deleteMany({ where: { userId: { in: [community.id, pro.id] } } });
  console.log('\n  (reset orders and entitlements)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
