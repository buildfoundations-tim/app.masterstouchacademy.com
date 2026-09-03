import 'server-only';

import { db } from '@/lib/db';
import { pricePurchase, type PricedLine, type PurchaseRequest, type PriceResult } from '@/lib/pricing';

// Pricing lives in @/lib/pricing (no server-only) so the test suite exercises
// the real function. Re-exported here so callers have one import.
export { pricePurchase };
export type { PricedLine, PurchaseRequest, PriceResult };
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

    // Anything just paid for leaves the cart. Scoped to this order's lines, so
    // a member who added more while checking out keeps those.
    const boughtCourseIds = order.items.map((i) => i.courseId).filter(Boolean) as string[];
    const boughtClassIds = order.items.map((i) => i.classId).filter(Boolean) as string[];
    if (boughtCourseIds.length || boughtClassIds.length) {
      await tx.cartItem.deleteMany({
        where: {
          userId: order.userId,
          OR: [
            ...(boughtCourseIds.length ? [{ courseId: { in: boughtCourseIds } }] : []),
            ...(boughtClassIds.length ? [{ classId: { in: boughtClassIds } }] : []),
          ],
        },
      });
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
