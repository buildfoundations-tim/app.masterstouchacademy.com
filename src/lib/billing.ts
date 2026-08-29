/**
 * Membership plans and the mapping between PayPal subscriptions and tiers.
 *
 * Prices mirror the marketing site's membership page. Annual billing is
 * "two months free": the monthly-equivalent figure is what the site advertises,
 * and the yearly charge is that times twelve.
 *
 * No `server-only` here — the plan table is safe to render, and the checks in
 * this file are pure so they can be unit-tested.
 */
import { TIER } from '@/lib/access';

export type Interval = 'month' | 'year';

export type Plan = {
  tier: number;
  interval: Interval;
  /** Stable key used for the PayPal plan's internal name and our env lookup. */
  key: string;
  label: string;
  /** What PayPal charges per cycle, in cents. */
  chargeCents: number;
  /** What the site advertises per month, in cents. */
  perMonthCents: number;
  blurb: string;
};

export const PLANS: Plan[] = [
  {
    tier: TIER.PRO, interval: 'month', key: 'pro-monthly', label: 'Pro',
    chargeCents: 6900, perMonthCents: 6900,
    blurb: 'Every continuing education course, on demand.',
  },
  {
    tier: TIER.PRO, interval: 'year', key: 'pro-yearly', label: 'Pro',
    chargeCents: 68400, perMonthCents: 5700,
    blurb: 'Every continuing education course, on demand.',
  },
  {
    tier: TIER.PRO_PLUS, interval: 'month', key: 'proplus-monthly', label: 'Pro+',
    chargeCents: 12999, perMonthCents: 12999,
    blurb: 'The library, the AI, and time with Tom.',
  },
  {
    tier: TIER.PRO_PLUS, interval: 'year', key: 'proplus-yearly', label: 'Pro+',
    chargeCents: 129600, perMonthCents: 10800,
    blurb: 'The library, the AI, and time with Tom.',
  },
  {
    tier: TIER.CREW_LEADER, interval: 'month', key: 'crew-monthly', label: 'Crew Leader',
    chargeCents: 24999, perMonthCents: 24999,
    blurb: 'Your whole crew, trained and tracked.',
  },
  {
    tier: TIER.CREW_LEADER, interval: 'year', key: 'crew-yearly', label: 'Crew Leader',
    chargeCents: 249600, perMonthCents: 20800,
    blurb: 'Your whole crew, trained and tracked.',
  },
];

export function findPlan(tier: number, interval: Interval): Plan | undefined {
  return PLANS.find((p) => p.tier === tier && p.interval === interval);
}

export function findPlanByKey(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}

/**
 * PayPal plan ids, injected per environment.
 *
 * They are created once by `npm run paypal:setup` and pasted into .env, because
 * sandbox and live have entirely different ids and creating them at runtime
 * would make a duplicate on every deploy.
 */
export function paypalPlanId(key: string): string | undefined {
  const envKey = `PAYPAL_PLAN_${key.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envKey];
}

export function planIdEnvName(key: string): string {
  return `PAYPAL_PLAN_${key.toUpperCase().replace(/-/g, '_')}`;
}

/** Every plan that has an id configured, i.e. is actually purchasable. */
export function availablePlans(): Plan[] {
  return PLANS.filter((p) => Boolean(paypalPlanId(p.key)));
}

/**
 * The tier a member should hold, given their subscriptions.
 *
 * Only an `active` subscription grants a tier. Everything else — pending,
 * suspended for non-payment, cancelled, expired — falls back to Community.
 * Where someone somehow holds two active subscriptions, the higher wins, so a
 * mid-cycle upgrade never demotes them.
 */
export function tierFromSubscriptions(
  subs: Array<{ status: string; tier: number }>
): number {
  const active = subs.filter((s) => s.status === 'active');
  if (active.length === 0) return TIER.COMMUNITY;
  return Math.max(...active.map((s) => s.tier));
}

/** Map PayPal's subscription status onto ours. */
export function mapStatus(paypalStatus: string): 'approval_pending' | 'approved' | 'active' | 'suspended' | 'cancelled' | 'expired' {
  switch (paypalStatus) {
    case 'APPROVAL_PENDING': return 'approval_pending';
    case 'APPROVED': return 'approved';
    case 'ACTIVE': return 'active';
    case 'SUSPENDED': return 'suspended';
    case 'CANCELLED': return 'cancelled';
    case 'EXPIRED': return 'expired';
    default: return 'approval_pending';
  }
}

/** Dollars string for the PayPal API, e.g. 6900 -> "69.00". */
export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}
