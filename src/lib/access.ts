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
import type { CourseGroup, UserRole } from '@/generated/prisma/enums';

/**
 * Staff run the school; members buy from it.
 *
 * The distinction used to be a boolean plus a tier of 4, which made the owner
 * read as a Crew Leader subscriber everywhere. Role and tier are now separate
 * questions: what someone *is*, and what they *pay for*.
 */
export function isStaff(role: UserRole): boolean {
  return role === 'owner' || role === 'instructor';
}

/** How to name an account in the UI. Staff are named by role, not by tier. */
export function roleLabel(role: UserRole, tier: number): string {
  if (role === 'owner') return 'Owner';
  if (role === 'instructor') return 'Instructor';
  return TIER_LABEL[tier] ?? `Tier ${tier}`;
}

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

/**
 * Whether being staff alone unlocks a course.
 *
 * Exactly what the CEC library gave the owner back when they were parked at
 * tier 4 — no more. **IICRC certification courses stay locked for staff too.**
 * That is not an oversight: CLAUDE.md is explicit that an owner seeing an IICRC
 * course unlocked without an entitlement is a bug, because certification has to
 * be earned and paid for by everyone, including the person who runs the school.
 */
export function staffIncludesCourse(role: UserRole, group: CourseGroup): boolean {
  return isStaff(role) && group === 'cec';
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
  /** Absent is treated as a plain member — callers that predate roles still work. */
  role?: UserRole;
  course: { id: string; group: CourseGroup };
  entitlements: EntitlementLike[];
  now?: Date;
}): boolean {
  const { tier, role = 'member', course, entitlements, now = new Date() } = args;

  const owned = entitlements.some(
    (e) => e.courseId === course.id && (e.expiresAt === null || e.expiresAt > now)
  );
  if (owned) return true;

  return tierIncludesCourse(tier, course.group) || staffIncludesCourse(role, course.group);
}

/** Why a course is locked, for the paywall copy. */
export type LockReason = 'purchase-required' | 'upgrade-or-purchase' | null;

export function lockReason(args: {
  tier: number;
  role?: UserRole;
  course: { id: string; group: CourseGroup };
  entitlements: EntitlementLike[];
}): LockReason {
  if (canAccessCourse(args)) return null;
  // A CEC course can be unlocked either by upgrading or by buying it outright;
  // an IICRC course can only be bought.
  return args.course.group === 'cec' ? 'upgrade-or-purchase' : 'purchase-required';
}
