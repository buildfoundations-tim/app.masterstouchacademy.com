/**
 * What a given buyer pays for a one-time purchase, and whether they may buy it.
 *
 * Deliberately free of `server-only` so the test suite calls exactly this
 * function rather than a copy of it — the same reason class-input.ts is split
 * out. A mirrored implementation in a test proves nothing once the two drift.
 *
 * The rule: **the amount is computed here, from the catalog and the buyer's
 * tier.** The caller says what is being bought, never what it costs. No code
 * path accepts a price from the browser.
 */
import { db } from '@/lib/db';
import type { UserRole } from '@/generated/prisma/enums';
import { canAccessCourse, discountedCents } from '@/lib/access';

export type PurchaseRequest =
  | { kind: 'course'; courseId: string }
  | { kind: 'class_seat'; classId: string; seatMode: 'inperson' | 'virtual' };

export type PricedLine = {
  kind: 'course' | 'class_seat';
  courseId?: string;
  classId?: string;
  seatMode?: string;
  description: string;
  /** List price before any tier discount, kept for the receipt. */
  listCents: number;
  /** What this buyer is actually charged. */
  unitCents: number;
};

export type PriceResult = { ok: true; line: PricedLine } | { ok: false; reason: string };

export async function pricePurchase(
  user: { id: string; tier: number; role?: UserRole },
  req: PurchaseRequest
): Promise<PriceResult> {
  if (req.kind === 'course') {
    const course = await db.course.findUnique({
      where: { id: req.courseId },
      select: { id: true, title: true, group: true, published: true, priceCents: true },
    });
    if (!course || !course.published) return { ok: false, reason: 'That course is not available.' };

    const entitlements = await db.entitlement.findMany({
      where: { userId: user.id },
      select: { courseId: true, expiresAt: true },
    });

    // Refuse to sell access someone already has — bought outright, or included
    // with their tier.
    if (canAccessCourse({ tier: user.tier, role: user.role, course, entitlements })) {
      return { ok: false, reason: 'You already have access to this course.' };
    }

    return {
      ok: true,
      line: {
        kind: 'course',
        courseId: course.id,
        description: course.title,
        listCents: course.priceCents,
        unitCents: discountedCents(course.priceCents, user.tier),
      },
    };
  }

  const klass = await db.scheduledClass.findUnique({
    where: { id: req.classId },
    select: {
      id: true, title: true, published: true, mode: true, seatsTotal: true,
      startDate: true, inPersonPriceCents: true, virtualPriceCents: true,
      _count: { select: { bookings: true } },
    },
  });
  if (!klass || !klass.published) return { ok: false, reason: 'That class is not available.' };

  if (klass.startDate < new Date()) {
    return { ok: false, reason: 'That class has already run.' };
  }

  const already = await db.seatBooking.findUnique({
    where: { classId_userId: { classId: klass.id, userId: user.id } },
    select: { id: true },
  });
  if (already) return { ok: false, reason: 'You already have a seat on this class.' };

  if (klass._count.bookings >= klass.seatsTotal) {
    return { ok: false, reason: 'That class is fully booked.' };
  }

  const wantsInPerson = req.seatMode === 'inperson';
  if (wantsInPerson && klass.mode === 'virtual') {
    return { ok: false, reason: 'That class is live stream only.' };
  }
  if (!wantsInPerson && klass.mode === 'inperson') {
    return { ok: false, reason: 'That class is in person only.' };
  }

  const listCents = wantsInPerson ? klass.inPersonPriceCents : klass.virtualPriceCents;
  if (listCents === null || listCents === undefined) {
    return { ok: false, reason: 'That seat format has no price set.' };
  }

  return {
    ok: true,
    line: {
      kind: 'class_seat',
      classId: klass.id,
      seatMode: req.seatMode,
      description: `${klass.title} — ${wantsInPerson ? 'classroom seat' : 'live stream'}`,
      listCents,
      unitCents: discountedCents(listCents, user.tier),
    },
  };
}
