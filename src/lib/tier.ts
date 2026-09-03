/**
 * What tier a member is on.
 *
 * Split out of subscriptions.ts and deliberately free of `server-only`: this is
 * the single writer of `User.tier`, and the check suite has to be able to run
 * the real function rather than a copy of it. A mirrored implementation in a
 * test proves nothing once the two drift — and the thing being tested here is
 * precisely that a hand-set tier is not quietly undone by a webhook.
 */
import { db } from '@/lib/db';
import { tierFromSubscriptions } from '@/lib/billing';

/**
 * Recompute a member's tier from their subscriptions and store it.
 *
 * User.tier is a denormalisation of "what are they paying for right now" —
 * kept because every access check reads it. This is what keeps it honest.
 *
 * Two exemptions, in order:
 *
 *  - **Staff.** An owner or instructor does not buy a membership at all.
 *  - **A tier override.** The owner can comp a member from Admin → Members.
 *    Without this branch the next subscription webhook would quietly undo it,
 *    and the member would lose access with nothing in the app explaining why.
 *
 * An override wins even when it is *lower* than what the member pays for. That
 * looks wrong until you need it — a downgrade after a chargeback is exactly the
 * case, and an override that only ever raised the tier could not express it.
 * The reason is recorded alongside so the screen can say who did it and why.
 */
export async function recalcUserTier(userId: string): Promise<number> {
  const [user, subs] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { role: true, tier: true, tierOverride: true },
    }),
    db.subscription.findMany({ where: { userId }, select: { status: true, tier: true } }),
  ]);

  if (!user) return 1;
  // Staff do not subscribe, so there is nothing to derive their tier from.
  if (user.role !== 'member') return user.tier;

  const tier = user.tierOverride ?? tierFromSubscriptions(subs);

  if (tier !== user.tier) {
    await db.user.update({ where: { id: userId }, data: { tier } });
  }
  return tier;
}
