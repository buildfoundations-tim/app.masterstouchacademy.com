/**
 * Reversing a purchase.
 *
 * Refunds are issued in PayPal, never here — this reacts to the webhook PayPal
 * sends afterwards. Split out of orders.ts and deliberately free of
 * `server-only` for the same reason as pricing.ts: the test suite exercises
 * this exact function rather than a copy of it.
 */
import { db } from '@/lib/db';

export type RefundResult =
  | { ok: true; revoked: boolean; partial: boolean }
  | { ok: false; reason: string };

/**
 * Record a refund and, when it is a full one, withdraw what the order granted.
 *
 * Called from the webhook on PAYMENT.CAPTURE.REFUNDED. PayPal is the authority
 * on refunds — they are issued there, not here — so this reacts rather than
 * initiates.
 *
 * A **partial** refund does not withdraw access. Half a course is not a thing,
 * and guessing which line was refunded would be worse than leaving it: the
 * order is flagged and the owner decides. Only a refund covering the full
 * amount revokes.
 *
 * `revokedAt` makes withdrawal idempotent — PayPal redelivers, and revoking
 * twice would delete grants the member has since re-earned by other means.
 */
export async function refundOrder(input: {
  captureId: string;
  refundedCents: number;
}): Promise<RefundResult> {
  const order = await db.order.findFirst({
    where: { paypalCaptureId: input.captureId },
    include: { items: true },
  });
  if (!order) return { ok: false, reason: 'unknown-capture' };

  // Refunds can arrive in instalments; accumulate rather than overwrite.
  const totalRefunded = (order.refundedCents ?? 0) + input.refundedCents;
  const partial = totalRefunded < order.totalCents;

  if (order.revokedAt) {
    // Already withdrawn. Keep the running total accurate and stop.
    await db.order.update({
      where: { id: order.id },
      data: { refundedCents: totalRefunded, refundedAt: new Date() },
    });
    return { ok: true, revoked: false, partial };
  }

  if (partial) {
    await db.order.update({
      where: { id: order.id },
      data: {
        refundedCents: totalRefunded,
        refundedAt: new Date(),
        error:
          `Partially refunded (${totalRefunded} of ${order.totalCents} cents). ` +
          'Access was NOT withdrawn — decide by hand.',
      },
    });
    return { ok: true, revoked: false, partial: true };
  }

  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      if (item.kind === 'course' && item.courseId) {
        // Only the purchase entitlement. A membership grant for the same course
        // is a different row and survives — the member still pays for that.
        await tx.entitlement.deleteMany({
          where: { userId: order.userId, courseId: item.courseId, source: 'purchase' },
        });
      }
      if (item.kind === 'class_seat' && item.classId) {
        await tx.seatBooking.deleteMany({
          where: { userId: order.userId, classId: item.classId },
        });
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'refunded',
        refundedCents: totalRefunded,
        refundedAt: new Date(),
        revokedAt: new Date(),
        error: null,
      },
    });
  });

  return { ok: true, revoked: true, partial: false };
}
