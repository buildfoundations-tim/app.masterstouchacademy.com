/**
 * Exercises Admin → Members.
 *
 * The two properties under test:
 *
 *  1. **A hand-set tier survives a subscription sync.** `User.tier` is derived
 *     from subscriptions, so an override that recalcUserTier() did not know
 *     about would be silently undone the next time PayPal sent an event — and
 *     a comped member would lose access with nothing explaining why. That is
 *     the bug this whole mechanism exists to prevent, so it is asserted
 *     directly by running the real recalc.
 *  2. **A grant and a purchase are separate rows.** Revoking a comp must never
 *     remove a course somebody paid for.
 *
 *   npx tsx scripts/check-members.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { listMembers, memberDetail, memberTotals, setTierOverride, grantCourse, revokeGrant } from '../src/lib/members';
import { recalcUserTier } from '../src/lib/tier';

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
 * Put the shared fixture back.
 *
 * In a `finally`, not at the end of main(): this suite parks a member at tier 4
 * with entitlements they should not have, and an abort half way through used to
 * leave that for the *other* suites to trip over — which is exactly what
 * happened, and it read as a failing access rule rather than a dirty database.
 */
async function reset(userId: string) {
  await db.entitlement.deleteMany({ where: { userId } });
  await db.subscription.deleteMany({ where: { userId } });
  await db.user.update({
    where: { id: userId },
    data: { tier: 1, tierOverride: null, tierOverrideAt: null, tierOverrideReason: null },
  });
}

async function main() {
  const member = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  const owner = await db.user.findFirstOrThrow({ where: { role: 'owner' } });
  const wrt = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });
  const cct = await db.course.findUniqueOrThrow({ where: { slug: 'cct' } });

  // Clean slate.
  await db.entitlement.deleteMany({ where: { userId: member.id } });
  await db.subscription.deleteMany({ where: { userId: member.id } });
  await db.user.update({
    where: { id: member.id },
    data: { tier: 1, tierOverride: null, tierOverrideAt: null, tierOverrideReason: null },
  });

  console.log('\nThe list:');
  const all = await listMembers();
  check('finds the seeded members', all.length >= 3, true);
  const found = await listMembers({ search: 'community@example.com' });
  check('search by email narrows to one', found.length, 1);
  check('and reports their tier', found[0]?.tier, 1);
  check('not flagged as hand-set', found[0]?.overridden, false);
  check('search matches nothing when it should', (await listMembers({ search: 'zzzznope' })).length, 0);
  check('tier filter excludes other tiers', (await listMembers({ tier: 4 })).every((m) => m.tier === 4), true);

  console.log('\nA hand-set tier:');
  const set = await setTierOverride({ userId: member.id, tier: 3, reason: 'Comped for the seminar' });
  check('accepted', set.ok, true);
  check('and applied', set.ok && set.tier, 3);
  let row = await db.user.findUniqueOrThrow({ where: { id: member.id } });
  check('tier written', row.tier, 3);
  check('override recorded', row.tierOverride, 3);
  check('with the reason', row.tierOverrideReason, 'Comped for the seminar');
  check('and a timestamp', row.tierOverrideAt !== null, true);

  console.log('\n  It survives a subscription sync — the whole point:');
  // recalcUserTier is what every PayPal webhook ends up calling. Before the
  // override existed this call is what would have reset the member to tier 1.
  check('recalc keeps the hand-set tier', await recalcUserTier(member.id), 3);
  check('even with no subscription at all', (await db.subscription.count({ where: { userId: member.id } })), 0);

  console.log('\n  An override can lower a tier, not only raise one:');
  await db.subscription.create({
    data: {
      userId: member.id, paypalSubscriptionId: 'TEST-SUB-MEMBERS', paypalPlanId: 'P-TEST',
      status: 'active', tier: 4, interval: 'month', priceCents: 9900,
    },
  });
  await setTierOverride({ userId: member.id, tier: 2, reason: 'Chargeback under review' });
  check('the lower hand-set tier wins', await recalcUserTier(member.id), 2);

  console.log('\n  Clearing it hands them back to what they pay for:');
  const cleared = await setTierOverride({ userId: member.id, tier: null, reason: '' });
  check('accepted', cleared.ok, true);
  check('back to the subscription tier', cleared.ok && cleared.tier, 4);
  row = await db.user.findUniqueOrThrow({ where: { id: member.id } });
  check('override gone', row.tierOverride, null);
  check('reason cleared too', row.tierOverrideReason, null);

  console.log('\n  Bad input is refused, not stored:');
  check('tier 0', (await setTierOverride({ userId: member.id, tier: 0, reason: '' })).ok, false);
  check('tier 5', (await setTierOverride({ userId: member.id, tier: 5, reason: '' })).ok, false);
  check('a fraction', (await setTierOverride({ userId: member.id, tier: 2.5, reason: '' })).ok, false);
  check('an unknown member', (await setTierOverride({ userId: 'nope', tier: 2, reason: '' })).ok, false);
  check('still on the subscription tier', (await db.user.findUniqueOrThrow({ where: { id: member.id } })).tier, 4);

  console.log('\n  Staff are refused, because recalc would ignore it anyway:');
  const ownerAttempt = await setTierOverride({ userId: owner.id, tier: 2, reason: '' });
  check('refused', ownerAttempt.ok, false);
  check('with a reason that explains it', !ownerAttempt.ok && ownerAttempt.reason.includes('Staff'), true);
  check("owner's tier untouched", (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).tier, owner.tier);
  check('and an owner carries no membership tier at all', owner.tier, 1);
  check('their role is what identifies them', owner.role, 'owner');

  console.log('\nGranting a course:');
  const g = await grantCourse({ userId: member.id, courseId: wrt.id });
  check('granted', g.ok && !g.already, true);
  check('as a grant, not a purchase', (await db.entitlement.findFirstOrThrow({ where: { userId: member.id, courseId: wrt.id } })).source, 'grant');
  check('with no expiry', (await db.entitlement.findFirstOrThrow({ where: { userId: member.id, courseId: wrt.id } })).expiresAt, null);
  check('granting twice is a no-op', (await grantCourse({ userId: member.id, courseId: wrt.id })) as unknown, { ok: true, already: true });
  check('an unknown course is refused', (await grantCourse({ userId: member.id, courseId: 'nope' })).ok, false);

  console.log('\n  Revoking a grant leaves a purchase alone:');
  // Same course, both sources — the case that would lose a member something
  // they paid for if revoke were not scoped to source: 'grant'.
  await db.entitlement.create({
    data: { userId: member.id, courseId: cct.id, source: 'purchase' },
  });
  await grantCourse({ userId: member.id, courseId: cct.id });
  check('both rows exist', await db.entitlement.count({ where: { userId: member.id, courseId: cct.id } }), 2);

  const revoked = await revokeGrant({ userId: member.id, courseId: cct.id });
  check('one row removed', revoked.removed, 1);
  check('the purchase survives', (await db.entitlement.findFirstOrThrow({ where: { userId: member.id, courseId: cct.id } })).source, 'purchase');
  check('revoking again removes nothing', (await revokeGrant({ userId: member.id, courseId: cct.id })).removed, 0);

  console.log('\nThe detail view:');
  const detail = await memberDetail(member.id);
  check('found', detail !== null, true);
  check('lists their access', detail!.entitlements.length, 2);
  check('reports what they pay for, separately from their tier', detail!.paidTier, 4);
  check('an unknown id returns null rather than throwing', await memberDetail('nope'), null);

  const totals = await memberTotals();
  check('totals count everyone', totals.total >= 3, true);
  check('and count paid tiers', totals.paying >= 1, true);

  // Reset.
  await db.entitlement.deleteMany({ where: { userId: member.id } });
  await db.subscription.deleteMany({ where: { userId: member.id } });
  await db.user.update({
    where: { id: member.id },
    data: { tier: 1, tierOverride: null, tierOverrideAt: null, tierOverrideReason: null },
  });
  console.log('\n  (member reset to tier 1 with no entitlements)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const member = await db.user.findUnique({ where: { email: 'community@example.com' } });
    if (member) await reset(member.id);
    console.log('  (fixture reset)');
    await db.$disconnect();
  });
