import 'server-only';

import { db } from '@/lib/db';
import { discountedCents, canAccessCourse } from '@/lib/access';
import { centsToValue } from '@/lib/billing';
import {
  captureOrder,
  getOrder,
  isAlreadyCaptured,
  type PayPalOrder,
} from '@/lib/paypal';

/**
 * One-time purchases: a course bought outright, or a seat on a scheduled class.
 *
 * The rule this file exists to protect: **the amount is computed here, from the
 * catalog and the buyer's tier.** The request says *what* to buy, never *what it
 * costs*. A price arriving from the browser is the classic way a checkout gets
 * robbed, and there is no code path that accepts one.
 */

export type PurchaseRequest =
  | { kind: 'course'; courseId: string }
  | { kind: 'class_seat'; classId: string; seatMode: 'inperson' | 'virtual' };

export type PricedLine = {
  kind: 'course' | 'class_seat';
  courseId?: string;
  classId?: string;
  seatMode?: string;
  description: string;
  listCents: number;
  unitCents: number;
};

export type PriceResult =
  | { ok: true; line: PricedLine }
  | { ok: false; reason: string };

/**
 * Work out what this buyer actually pays, and refuse anything they should not
 * be buying — a course they already have, a class with no seats left, a seat
 * format the class does not run.
 */
export async function pricePurchase(
  user: { id: string; tier: number },
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

    // Refuse to sell access someone already has — whether bought or included
    // with their tier.
    if (canAccessCourse({ tier: user.tier, course, entitlements })) {
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

/** Create our Order row plus its line, ready to hand to PayPal. */
export async function createLocalOrder(userId: string, line: PricedLine, paypalOrderId: string) {
  return db.order.create({
    data: {
      userId,
      paypalOrderId,
      status: 'created',
      totalCents: line.unitCents,
      items: {
        create: {
          kind: line.kind,
          courseId: line.courseId ?? null,
          classId: line.classId ?? null,
          seatMode: line.seatMode ?? null,
          description: line.description,
          listCents: line.listCents,
          unitCents: line.unitCents,
        },
      },
    },
    include: { items: true },
  });
}

export type SettleResult =
  | { ok: true; alreadyDone: boolean; order: { id: string } }
  | { ok: false; reason: string };

/**
 * Capture the payment and grant what was bought.
 *
 * Called from both the return page and the webhook, so it must be safe to run
 * twice. `fulfilledAt` is the guard: once set, granting is skipped entirely.
 *
 * The captured amount is checked against what we asked for. A mismatch is
 * recorded and fulfilment refused rather than quietly handing over a course for
 * whatever was actually paid.
 */
export async function settleOrder(paypalOrderId: string): Promise<SettleResult> {
  const order = await db.order.findUnique({
    where: { paypalOrderId },
    include: { items: true },
  });
  if (!order) return { ok: false, reason: 'unknown-order' };
  if (order.fulfilledAt) return { ok: true, alreadyDone: true, order: { id: order.id } };

  let remote: PayPalOrder;
  try {
    remote = await captureOrder(paypalOrderId);
  } catch (e) {
    if (isAlreadyCaptured(e)) {
      // Someone else captured it first — the webhook and the return page
      // racing. Read the real state instead of failing.
      try {
        remote = await getOrder(paypalOrderId);
      } catch {
        return { ok: false, reason: 'paypal-unreachable' };
      }
    } else {
      await db.order.update({
        where: { id: order.id },
        data: { status: 'failed', error: e instanceof Error ? e.message.slice(0, 500) : 'capture failed' },
      });
      return { ok: false, reason: 'capture-failed' };
    }
  }

  if (remote.status !== 'COMPLETED') {
    await db.order.update({
      where: { id: order.id },
      data: { error: `PayPal order status is ${remote.status}` },
    });
    return { ok: false, reason: `not-completed:${remote.status}` };
  }

  const capture = remote.purchase_units?.[0]?.payments?.captures?.[0];
  const paidValue = capture?.amount?.value ?? remote.purchase_units?.[0]?.amount?.value;
  const expected = centsToValue(order.totalCents);

  if (paidValue && paidValue !== expected) {
    await db.order.update({
      where: { id: order.id },
      data: {
        status: 'failed',
        error: `amount mismatch: PayPal captured ${paidValue}, expected ${expected}`,
      },
    });
    return { ok: false, reason: 'amount-mismatch' };
  }

  // Grant, then mark fulfilled — in one transaction, so a crash between the
  // two cannot leave a paid order ungranted or a grant unrecorded.
  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      if (item.kind === 'course' && item.courseId) {
        await tx.entitlement.upsert({
          where: {
            userId_courseId_source: {
              userId: order.userId,
              courseId: item.courseId,
              source: 'purchase',
            },
          },
          create: {
            userId: order.userId,
            courseId: item.courseId,
            source: 'purchase',
            // A course purchase is one year of access, per the marketing site.
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          },
          update: {},
        });
      }

      if (item.kind === 'class_seat' && item.classId) {
        await tx.seatBooking.upsert({
          where: { classId_userId: { classId: item.classId, userId: order.userId } },
          create: {
            classId: item.classId,
            userId: order.userId,
            mode: item.seatMode === 'inperson' ? 'inperson' : 'virtual',
            paidCents: item.unitCents,
          },
          update: {},
        });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'completed',
        paypalCaptureId: capture?.id ?? null,
        capturedAt: new Date(),
        fulfilledAt: new Date(),
        error: null,
      },
    });
  });

  return { ok: true, alreadyDone: false, order: { id: order.id } };
}
