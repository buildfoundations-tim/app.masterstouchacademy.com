/**
 * Exercises the subscription -> tier rules and the plan table.
 *
 * These decide what a paying member gets, so they are asserted rather than
 * assumed. No PayPal credentials needed — the network calls are not exercised
 * here; this covers the logic that runs after PayPal answers.
 *
 *   npx tsx scripts/check-billing.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { PLANS, findPlan, findPlanByKey, tierFromSubscriptions, mapStatus, centsToValue, planIdEnvName } from '../src/lib/billing';
import { TIER } from '../src/lib/access';

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
  console.log('\nPlan table matches the advertised pricing:');
  check('six plans (three tiers x two intervals)', PLANS.length, 6);
  check('Pro monthly is $69', findPlan(TIER.PRO, 'month')?.chargeCents, 6900);
  check('Pro+ monthly is $129.99', findPlan(TIER.PRO_PLUS, 'month')?.chargeCents, 12999);
  check('Crew Leader monthly is $249.99', findPlan(TIER.CREW_LEADER, 'month')?.chargeCents, 24999);
  check('Pro yearly charges $684', findPlan(TIER.PRO, 'year')?.chargeCents, 68400);
  check('Pro yearly advertises $57/mo', findPlan(TIER.PRO, 'year')?.perMonthCents, 5700);
  check('Crew Leader yearly charges $2,496', findPlan(TIER.CREW_LEADER, 'year')?.chargeCents, 249600);

  console.log('\nYearly billing:');
  for (const tier of [TIER.PRO, TIER.PRO_PLUS, TIER.CREW_LEADER]) {
    const monthly = findPlan(tier, 'month')!;
    const yearly = findPlan(tier, 'year')!;

    // The advertised per-month figure must be exactly the yearly charge / 12,
    // or the site quotes a rate nobody is actually billed.
    check(
      `tier ${tier}: advertised monthly rate x 12 == the yearly charge`,
      yearly.perMonthCents * 12,
      yearly.chargeCents
    );

    // "Two months free" is the claim on the marketing site. The member must get
    // at least that — delivering less than advertised is the failure mode worth
    // guarding. In practice the saving is a little over two months.
    const saved = monthly.chargeCents * 12 - yearly.chargeCents;
    check(`tier ${tier}: saves at least two monthly payments`, saved >= monthly.chargeCents * 2, true);
  }

  // The exact figures quoted on the marketing site's membership page.
  check('Pro saves $144 a year', findPlan(TIER.PRO, 'month')!.chargeCents * 12 - findPlan(TIER.PRO, 'year')!.chargeCents, 14400);
  check('Crew Leader saves $503.88 a year', findPlan(TIER.CREW_LEADER, 'month')!.chargeCents * 12 - findPlan(TIER.CREW_LEADER, 'year')!.chargeCents, 50388);

  console.log('\nNo free tier is purchasable:');
  check('Community has no plan', PLANS.some((p) => p.tier === TIER.COMMUNITY), false);

  console.log('\nMoney formatting for the PayPal API:');
  check('6900 -> "69.00"', centsToValue(6900), '69.00');
  check('12999 -> "129.99"', centsToValue(12999), '129.99');
  check('249600 -> "2496.00"', centsToValue(249600), '2496.00');

  console.log('\nEnv var naming is stable:');
  check('pro-monthly', planIdEnvName('pro-monthly'), 'PAYPAL_PLAN_PRO_MONTHLY');
  check('crew-yearly', planIdEnvName('crew-yearly'), 'PAYPAL_PLAN_CREW_YEARLY');
  check('every plan key resolves', PLANS.every((p) => findPlanByKey(p.key) !== undefined), true);

  console.log('\nOnly an ACTIVE subscription grants a tier:');
  check('no subscriptions -> Community', tierFromSubscriptions([]), TIER.COMMUNITY);
  check('active Pro -> Pro', tierFromSubscriptions([{ status: 'active', tier: 2 }]), TIER.PRO);
  check('approval_pending -> Community', tierFromSubscriptions([{ status: 'approval_pending', tier: 3 }]), TIER.COMMUNITY);
  check('approved but not active -> Community', tierFromSubscriptions([{ status: 'approved', tier: 3 }]), TIER.COMMUNITY);
  check('suspended (failed payment) -> Community', tierFromSubscriptions([{ status: 'suspended', tier: 4 }]), TIER.COMMUNITY);
  check('cancelled -> Community', tierFromSubscriptions([{ status: 'cancelled', tier: 4 }]), TIER.COMMUNITY);
  check('expired -> Community', tierFromSubscriptions([{ status: 'expired', tier: 4 }]), TIER.COMMUNITY);
  check(
    'two active: the higher tier wins (no mid-upgrade demotion)',
    tierFromSubscriptions([{ status: 'active', tier: 2 }, { status: 'active', tier: 4 }]),
    TIER.CREW_LEADER
  );
  check(
    'a cancelled higher tier does not beat an active lower one',
    tierFromSubscriptions([{ status: 'cancelled', tier: 4 }, { status: 'active', tier: 2 }]),
    TIER.PRO
  );

  console.log('\nPayPal status mapping:');
  check('ACTIVE', mapStatus('ACTIVE'), 'active');
  check('APPROVAL_PENDING', mapStatus('APPROVAL_PENDING'), 'approval_pending');
  check('SUSPENDED', mapStatus('SUSPENDED'), 'suspended');
  check('CANCELLED', mapStatus('CANCELLED'), 'cancelled');
  check('EXPIRED', mapStatus('EXPIRED'), 'expired');
  check('an unknown status is never treated as active', mapStatus('SOMETHING_NEW'), 'approval_pending');

  console.log('\nEnd to end against the database:');
  const member = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  await db.subscription.deleteMany({ where: { userId: member.id } });

  const pro = findPlan(TIER.PRO, 'month')!;
  await db.subscription.create({
    data: {
      userId: member.id,
      paypalSubscriptionId: 'I-TEST-CHECK-BILLING',
      paypalPlanId: 'P-TEST',
      status: 'approval_pending',
      tier: pro.tier,
      interval: pro.interval,
      priceCents: pro.chargeCents,
    },
  });

  const pending = await db.subscription.findMany({
    where: { userId: member.id }, select: { status: true, tier: true },
  });
  check('pending subscription grants nothing', tierFromSubscriptions(pending), TIER.COMMUNITY);

  await db.subscription.update({
    where: { paypalSubscriptionId: 'I-TEST-CHECK-BILLING' },
    data: { status: 'active' },
  });
  const active = await db.subscription.findMany({
    where: { userId: member.id }, select: { status: true, tier: true },
  });
  check('activating grants Pro', tierFromSubscriptions(active), TIER.PRO);

  await db.subscription.update({
    where: { paypalSubscriptionId: 'I-TEST-CHECK-BILLING' },
    data: { status: 'cancelled' },
  });
  const cancelled = await db.subscription.findMany({
    where: { userId: member.id }, select: { status: true, tier: true },
  });
  check('cancelling drops back to Community', tierFromSubscriptions(cancelled), TIER.COMMUNITY);

  console.log('\nWebhook idempotency is enforced by the database:');
  await db.webhookEvent.deleteMany({ where: { transmissionId: 'test-transmission-1' } });
  await db.webhookEvent.create({
    data: {
      transmissionId: 'test-transmission-1',
      eventId: 'WH-TEST',
      eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
      payload: {},
    },
  });
  let duplicateRejected = false;
  try {
    await db.webhookEvent.create({
      data: {
        transmissionId: 'test-transmission-1',
        eventId: 'WH-TEST',
        eventType: 'BILLING.SUBSCRIPTION.ACTIVATED',
        payload: {},
      },
    });
  } catch {
    duplicateRejected = true;
  }
  check('a redelivered transmission id is rejected', duplicateRejected, true);

  await db.webhookEvent.deleteMany({ where: { transmissionId: 'test-transmission-1' } });
  await db.subscription.deleteMany({ where: { userId: member.id } });
  await db.user.update({ where: { id: member.id }, data: { tier: 1 } });
  console.log('\n  (reset test subscription, webhook, and tier)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
