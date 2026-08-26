/**
 * Tier and entitlement rules.
 *
 * This module is the single place these rules live. Every one of them is
 * enforced server-side — a tier or an entitlement arriving from the client is
 * never trusted, because the whole commercial model rests on it.
 *
 * From CLAUDE.md, load-bearing and not to be "simplified":
 *   - Tier is an ordinal number 1–4, compared with >=, never an enum.
 *   - Course access = purchased, OR (tier >= 2 AND group === 'cec').
 *     IICRC certification courses stay a la carte at every tier.
 */
import type { CourseGroup } from '@/generated/prisma/enums';

export const TIER = {
  COMMUNITY: 1,
  PRO: 2,
  PRO_PLUS: 3,
  CREW_LEADER: 4,
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

export const TIER_LABEL: Record<number, string> = {
  1: 'Community',
  2: 'Pro',
  3: 'Pro+',
  4: 'Crew Leader',
};

/** Monthly price in cents. Community is free. */
export const TIER_PRICE_CENTS: Record<number, number> = {
  1: 0,
  2: 6900,
  3: 12999,
  4: 24999,
};

/** Coerce anything persisted or supplied into a valid tier. */
export function normalizeTier(value: unknown): Tier {
  const n = Number(value);
  if (!Number.isFinite(n)) return TIER.COMMUNITY;
  const clamped = Math.min(4, Math.max(1, Math.trunc(n)));
  return clamped as Tier;
}

/**
 * Discount applied to class seats and marketplace items.
 * Pro 10%, Pro+ and Crew Leader 20%, Community none.
 */
export function classDiscount(tier: number): number {
  if (tier >= TIER.PRO_PLUS) return 0.2;
  if (tier === TIER.PRO) return 0.1;
  return 0;
}

/** Group meetups included per month. */
export function meetupsPerMonth(tier: number): number {
  if (tier >= TIER.PRO_PLUS) return 3;
  if (tier === TIER.PRO) return 2;
  return 1;
}

/** Consulting sessions included per year. Pro+ and above only. */
export function consultingSessionsPerYear(tier: number): number {
  return tier >= TIER.PRO_PLUS ? 4 : 0;
}

/** Crew seats bundled with the tier. Only Crew Leader includes any. */
export function includedCrewSeats(tier: number): number {
  return tier >= TIER.CREW_LEADER ? 5 : 0;
}

/** Apply the tier discount to a price in cents, rounded to the nearest cent. */
export function discountedCents(priceCents: number, tier: number): number {
  return Math.round(priceCents * (1 - classDiscount(tier)));
}

/**
 * Whether a paid tier alone unlocks a course.
 *
 * The CEC library is included with Pro and above. IICRC certification courses
 * never are — they are purchased separately at every tier.
 */
export function tierIncludesCourse(tier: number, group: CourseGroup): boolean {
  return tier >= TIER.PRO && group === 'cec';
}

export type EntitlementLike = {
  courseId: string;
  expiresAt: Date | null;
};

/**
 * The access decision. Callers pass the user's tier, the course, and the
 * entitlement rows already loaded for that user — this stays a pure function so
 * it can be unit-tested and reused in both page loaders and route handlers.
 */
export function canAccessCourse(args: {
  tier: number;
  course: { id: string; group: CourseGroup };
  entitlements: EntitlementLike[];
  now?: Date;
}): boolean {
  const { tier, course, entitlements, now = new Date() } = args;

  const owned = entitlements.some(
    (e) => e.courseId === course.id && (e.expiresAt === null || e.expiresAt > now)
  );
  if (owned) return true;

  return tierIncludesCourse(tier, course.group);
}

/** Why a course is locked, for the paywall copy. */
export type LockReason = 'purchase-required' | 'upgrade-or-purchase' | null;

export function lockReason(args: {
  tier: number;
  course: { id: string; group: CourseGroup };
  entitlements: EntitlementLike[];
}): LockReason {
  if (canAccessCourse(args)) return null;
  // A CEC course can be unlocked either by upgrading or by buying it outright;
  // an IICRC course can only be bought.
  return args.course.group === 'cec' ? 'upgrade-or-purchase' : 'purchase-required';
}
