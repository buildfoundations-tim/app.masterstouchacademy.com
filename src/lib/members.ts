/**
 * Reading and adjusting members, for Admin → Members.
 *
 * The list mirrors the prototype's table. The detail view goes beyond it: the
 * prototype's members screen is read-only, but an owner needs to *act* — comp
 * someone to a tier, grant a course, put back access a refund withdrew. A
 * read-only screen would send Tom to a database client for exactly the cases
 * that matter most.
 *
 * Two rules hold everything here together:
 *
 *  1. **Tier is never written directly.** `User.tier` is derived from
 *     subscriptions by `recalcUserTier()`. Setting a tier by hand writes
 *     `tierOverride` and then asks that function to recompute, so there is one
 *     place that decides what a member's tier is.
 *  2. **A granted course is its own entitlement row.** `source: 'grant'` sits
 *     alongside a purchase rather than replacing it, so revoking a comp cannot
 *     take away something the member paid for.
 *
 * No `server-only`: the test suite exercises these directly.
 */
import { db } from '@/lib/db';
import { recalcUserTier } from '@/lib/tier';
import { roleLabel, isStaff } from '@/lib/access';
import type { UserRole } from '@/generated/prisma/enums';
import { tierFromSubscriptions } from '@/lib/billing';

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  tier: number;
  /** How to name them: their role if staff, otherwise their tier. */
  label: string;
  /** True when the tier was set by hand rather than bought. */
  overridden: boolean;
  role: UserRole;
  isStaff: boolean;
  joinedAt: Date;
  lastSeenAt: Date | null;
  emailVerifiedAt: Date | null;
  courseCount: number;
  certificateCount: number;
};

/**
 * The member list.
 *
 * `search` matches name, email or company. `tier` narrows to one tier — the
 * question "who is on Pro+" is the one an owner actually asks.
 */
export async function listMembers(
  opts: { search?: string; tier?: number; limit?: number } = {}
): Promise<MemberRow[]> {
  const search = opts.search?.trim();

  const rows = await db.user.findMany({
    where: {
      ...(opts.tier ? { tier: opts.tier } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { company: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: opts.limit ?? 200,
    select: {
      id: true, email: true, firstName: true, lastName: true, displayName: true,
      company: true, tier: true, tierOverride: true, role: true,
      createdAt: true, lastSeenAt: true, emailVerifiedAt: true,
      _count: { select: { entitlements: true, certificates: true } },
    },
  });

  return rows.map((u) => ({
    id: u.id,
    name: u.displayName || `${u.firstName} ${u.lastName}`.trim(),
    email: u.email,
    company: u.company,
    tier: u.tier,
    label: roleLabel(u.role, u.tier),
    overridden: u.tierOverride !== null,
    role: u.role,
    isStaff: isStaff(u.role),
    joinedAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
    emailVerifiedAt: u.emailVerifiedAt,
    courseCount: u._count.entitlements,
    certificateCount: u._count.certificates,
  }));
}

/** Headline counts for the top of the screen. */
export async function memberTotals() {
  const [total, byTier, unverified, overridden] = await Promise.all([
    db.user.count(),
    db.user.groupBy({ by: ['tier'], _count: { _all: true } }),
    db.user.count({ where: { emailVerifiedAt: null } }),
    db.user.count({ where: { tierOverride: { not: null } } }),
  ]);

  // Staff are excluded: they carry tier 1 and are not members, so counting
  // them would overstate the audience on every tile.
  const paying = byTier
    .filter((g) => g.tier >= 2)
    .reduce((a, g) => a + g._count._all, 0);

  return {
    total,
    paying,
    unverified,
    overridden,
    perTier: Object.fromEntries(byTier.map((g) => [g.tier, g._count._all])) as Record<number, number>,
  };
}

/** Everything Admin → Members shows for one person. */
export async function memberDetail(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, displayName: true,
      phone: true, company: true, jobTitle: true, city: true, website: true,
      tier: true, tierOverride: true, tierOverrideAt: true, tierOverrideReason: true,
      role: true,
      createdAt: true, lastSeenAt: true, emailVerifiedAt: true, onboardedAt: true,

      entitlements: {
        orderBy: { grantedAt: 'desc' },
        select: {
          id: true, source: true, grantedAt: true, expiresAt: true,
          course: { select: { id: true, code: true, title: true, slug: true, group: true } },
        },
      },
      certificates: {
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true, shareId: true, issuedAt: true, ceHours: true, score: true,
          course: { select: { code: true, title: true } },
        },
      },
      seatBookings: {
        orderBy: { bookedAt: 'desc' },
        select: {
          id: true, mode: true, bookedAt: true, paidCents: true,
          class: { select: { title: true, dateLabel: true, startDate: true, location: true } },
        },
      },
      subscriptions: {
        orderBy: { createdAt: 'desc' },
        select: {
          paypalSubscriptionId: true, status: true, tier: true, interval: true,
          priceCents: true, startedAt: true, currentPeriodEnd: true, cancelledAt: true,
        },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, paypalOrderId: true, status: true, totalCents: true,
          createdAt: true, refundedAt: true, refundedCents: true,
        },
      },
    },
  });

  if (!user) return null;

  const spentCents = user.orders
    .filter((o) => o.status === 'completed')
    .reduce((a, o) => a + o.totalCents, 0);
  const refundedCents = user.orders.reduce((a, o) => a + (o.refundedCents ?? 0), 0);

  return {
    ...user,
    name: user.displayName || `${user.firstName} ${user.lastName}`.trim(),
    label: roleLabel(user.role, user.tier),
    isStaff: isStaff(user.role),
    spentCents,
    refundedCents,
    /** What the tier would be with the override removed. */
    paidTier: tierFromSubscriptions(user.subscriptions),
  };
}

export type AdjustResult = { ok: true; tier: number } | { ok: false; reason: string };

/**
 * Set or clear a hand-set tier.
 *
 * Writes `tierOverride` and lets `recalcUserTier()` decide what lands in
 * `tier` — one place decides, always. Passing `null` clears the override and
 * hands the member back to what they actually pay for.
 */
export async function setTierOverride(input: {
  userId: string;
  tier: number | null;
  reason: string;
}): Promise<AdjustResult> {
  if (input.tier !== null && (input.tier < 1 || input.tier > 4 || !Number.isInteger(input.tier))) {
    return { ok: false, reason: 'Tier must be a whole number from 1 to 4.' };
  }

  const user = await db.user.findUnique({ where: { id: input.userId }, select: { role: true } });
  if (!user) return { ok: false, reason: 'No such member.' };
  if (isStaff(user.role)) {
    // recalcUserTier returns early for staff, so an override would be stored
    // and never applied — a control that silently does nothing is worse than
    // one that is not offered. Staff do not have a membership to adjust.
    return { ok: false, reason: 'Staff accounts do not carry a membership tier, so there is nothing to set.' };
  }

  await db.user.update({
    where: { id: input.userId },
    data:
      input.tier === null
        ? { tierOverride: null, tierOverrideAt: null, tierOverrideReason: null }
        : {
            tierOverride: input.tier,
            tierOverrideAt: new Date(),
            tierOverrideReason: input.reason.trim() || null,
          },
  });

  return { ok: true, tier: await recalcUserTier(input.userId) };
}

/**
 * Give a member a course outright.
 *
 * Its own entitlement row (`source: 'grant'`) rather than a purchase, so the
 * two can coexist and revoking a comp never removes something that was paid
 * for. No expiry: a grant is a decision, not a subscription.
 */
export async function grantCourse(input: {
  userId: string;
  courseId: string;
}): Promise<{ ok: true; already: boolean } | { ok: false; reason: string }> {
  const [user, course] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
    db.course.findUnique({ where: { id: input.courseId }, select: { id: true } }),
  ]);
  if (!user) return { ok: false, reason: 'No such member.' };
  if (!course) return { ok: false, reason: 'No such course.' };

  const existing = await db.entitlement.findFirst({
    where: { userId: input.userId, courseId: input.courseId, source: 'grant' },
    select: { id: true },
  });
  if (existing) return { ok: true, already: true };

  await db.entitlement.create({
    data: { userId: input.userId, courseId: input.courseId, source: 'grant' },
  });
  return { ok: true, already: false };
}

/**
 * Take back a granted course.
 *
 * Scoped to `source: 'grant'` on purpose. A purchase is not the owner's to
 * remove from this screen — that is what a refund is for, and refunding is
 * done in PayPal.
 */
export async function revokeGrant(input: {
  userId: string;
  courseId: string;
}): Promise<{ ok: true; removed: number }> {
  const { count } = await db.entitlement.deleteMany({
    where: { userId: input.userId, courseId: input.courseId, source: 'grant' },
  });
  return { ok: true, removed: count };
}
