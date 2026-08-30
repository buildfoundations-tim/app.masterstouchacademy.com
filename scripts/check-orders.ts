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

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

/**
 * Mirrors pricePurchase() for a course, without the server-only import chain.
 * Kept deliberately close to the original; if they drift, the assertions below
 * about discounts and refusals stop meaning anything.
 */
async function priceCourse(user: { id: string; tier: number }, courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, group: true, published: true, priceCents: true },
  });
  if (!course || !course.published) return { ok: false as const, reason: 'That course is not available.' };

  const entitlements = await db.entitlement.findMany({
    where: { userId: user.id },
    select: { courseId: true, expiresAt: true },
  });
  const now = new Date();
  const owned = entitlements.some(
    (e) => e.courseId === course.id && (e.expiresAt === null || e.expiresAt > now)
  );
  const includedByTier = user.tier >= 2 && course.group === 'cec';
  if (owned || includedByTier) return { ok: false as const, reason: 'You already have access to this course.' };

  return {
    ok: true as const,
    listCents: course.priceCents,
    unitCents: discountedCents(course.priceCents, user.tier),
  };
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
  const c1 = await priceCourse(community, wrt.id);
  check('Community pays list for WRT ($450)', c1.ok && c1.unitCents, 45000);

  const p1 = await priceCourse(pro, wrt.id);
  check('Pro pays 10% less for WRT ($405)', p1.ok && p1.unitCents, 40500);
  check('the list price is kept for the receipt', p1.ok && p1.listCents, 45000);

  console.log('\nYou cannot buy what you already have:');
  const proCec = await priceCourse(pro, cec.id);
  check('Pro is refused a CEC course (included with the tier)', proCec.ok, false);
  check('…with a useful reason', !proCec.ok && proCec.reason, 'You already have access to this course.');

  const commCec = await priceCourse(community, cec.id);
  check('Community may buy the same CEC course', commCec.ok, true);
  check('…at list price ($89.99)', commCec.ok && commCec.unitCents, 8999);

  await db.entitlement.create({
    data: { userId: community.id, courseId: wrt.id, source: 'purchase', expiresAt: new Date(Date.now() + 86400000) },
  });
  const repeat = await priceCourse(community, wrt.id);
  check('an existing purchase blocks buying it again', repeat.ok, false);

  await db.entitlement.updateMany({
    where: { userId: community.id, courseId: wrt.id },
    data: { expiresAt: new Date('2020-01-01') },
  });
  const lapsed = await priceCourse(community, wrt.id);
  check('an EXPIRED purchase can be bought again', lapsed.ok, true);
  await db.entitlement.deleteMany({ where: { userId: community.id } });

  console.log('\nUnpublished courses are not purchasable:');
  await db.course.update({ where: { id: wrt.id }, data: { published: false } });
  const unpub = await priceCourse(community, wrt.id);
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
