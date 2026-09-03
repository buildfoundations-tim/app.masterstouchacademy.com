import 'server-only';

import { db } from '@/lib/db';
import { recalcUserTier } from '@/lib/tier';
import { getSubscription } from '@/lib/paypal';
import { findPlanByKey, mapStatus } from '@/lib/billing';

/**
 * Reconcile one subscription against PayPal and re-derive the member's tier.
 *
 * This is the ONLY path that writes User.tier. Both the webhook and the
 * return-from-PayPal page call it, and both go and ask PayPal for the current
 * state rather than believing what they were handed — a webhook body could be
 * forged if verification were ever bypassed, and the return URL is fully under
 * the member's control.
 *
 * Safe to call repeatedly: it converges on whatever PayPal currently says.
 */
export async function syncSubscription(paypalSubscriptionId: string): Promise<{
  ok: boolean;
  tier?: number;
  status?: string;
  reason?: string;
}> {
  const local = await db.subscription.findUnique({
    where: { paypalSubscriptionId },
    select: { id: true, userId: true, tier: true },
  });

  if (!local) {
    // A subscription we have no record of. Could be a webhook arriving before
    // our create finished, or one made outside the app entirely.
    return { ok: false, reason: 'unknown-subscription' };
  }

  let remote;
  try {
    remote = await getSubscription(paypalSubscriptionId);
  } catch {
    return { ok: false, reason: 'paypal-unreachable' };
  }

  const status = mapStatus(remote.status);

  await db.subscription.update({
    where: { paypalSubscriptionId },
    data: {
      status,
      startedAt: remote.start_time ? new Date(remote.start_time) : undefined,
      currentPeriodEnd: remote.billing_info?.next_billing_time
        ? new Date(remote.billing_info.next_billing_time)
        : null,
      cancelledAt: status === 'cancelled' || status === 'expired' ? new Date() : null,
    },
  });

  const tier = await recalcUserTier(local.userId);
  return { ok: true, tier, status };
}

/**
 * Record a subscription we just created at PayPal, before the member approves.
 *
 * Stored at approval_pending so an approval webhook arriving moments later has
 * a row to attach to.
 */
export async function recordPendingSubscription(input: {
  userId: string;
  paypalSubscriptionId: string;
  paypalPlanId: string;
  planKey: string;
}): Promise<void> {
  const plan = findPlanByKey(input.planKey);
  if (!plan) throw new Error(`Unknown plan key: ${input.planKey}`);

  await db.subscription.upsert({
    where: { paypalSubscriptionId: input.paypalSubscriptionId },
    create: {
      userId: input.userId,
      paypalSubscriptionId: input.paypalSubscriptionId,
      paypalPlanId: input.paypalPlanId,
      status: 'approval_pending',
      tier: plan.tier,
      interval: plan.interval,
      priceCents: plan.chargeCents,
    },
    update: {},
  });
}

/** The subscription currently granting this member their tier, if any. */
export async function activeSubscription(userId: string) {
  return db.subscription.findFirst({
    where: { userId, status: 'active' },
    orderBy: { tier: 'desc' },
    select: {
      id: true,
      paypalSubscriptionId: true,
      tier: true,
      interval: true,
      priceCents: true,
      startedAt: true,
      currentPeriodEnd: true,
    },
  });
}

// recalcUserTier lives in @/lib/tier (no server-only) so the checks can run the
// real function — the same reason pricing.ts and refunds.ts are split out.
// Re-exported so callers keep one import site.
export { recalcUserTier } from '@/lib/tier';
