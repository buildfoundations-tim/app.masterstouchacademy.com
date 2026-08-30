import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { readWebhookHeaders, verifyWebhook } from '@/lib/paypal';
import { syncSubscription } from '@/lib/subscriptions';
import { settleOrder } from '@/lib/orders';

/**
 * PayPal webhook receiver.
 *
 * Three rules, in order:
 *
 *  1. Verify before anything else. An unverified delivery is discarded — it is
 *     an unauthenticated public endpoint and anyone can POST to it.
 *  2. Record the transmission id before handling. PayPal retries on any non-2xx
 *     and can redeliver, so handlers must be idempotent; the unique constraint
 *     on transmissionId is what enforces that.
 *  3. Re-read state from PayPal rather than trusting the payload. syncSubscription
 *     goes and asks. The body tells us *what changed*, never *what is true*.
 *
 * Always 200 once verified, even on an internal error — a non-2xx makes PayPal
 * retry, and a bug in our handler is not fixed by being sent the event again.
 * Failures are recorded on the WebhookEvent row instead.
 */

const HANDLED = new Set([
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'BILLING.SUBSCRIPTION.UPDATED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'PAYMENT.SALE.COMPLETED',
  'PAYMENT.CAPTURE.COMPLETED',
  'CHECKOUT.ORDER.APPROVED',
]);

export async function POST(request: Request) {
  const headers = readWebhookHeaders(request.headers);
  if (!headers) {
    return NextResponse.json({ error: 'missing transmission headers' }, { status: 400 });
  }

  // Parse the body ourselves: the signature is computed over exactly these
  // bytes, so it must be passed through unmodified.
  const raw = await request.text();
  let event: {
    id?: string;
    event_type?: string;
    resource?: {
      id?: string;
      billing_agreement_id?: string;
      custom_id?: string;
      supplementary_data?: { related_ids?: { order_id?: string } };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const verified = await verifyWebhook({ headers, event });
  if (!verified) {
    // 401, not 400: this is an authentication failure, and PayPal should not
    // treat it as a malformed request worth reshaping.
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }

  const eventType = event.event_type ?? 'UNKNOWN';

  // Idempotency gate. A duplicate transmission id means we have seen this
  // delivery; acknowledge and stop.
  try {
    await db.webhookEvent.create({
      data: {
        transmissionId: headers.transmissionId,
        eventId: event.id ?? 'unknown',
        eventType,
        resourceId: event.resource?.id ?? event.resource?.billing_agreement_id ?? null,
        payload: event as object,
      },
    });
  } catch {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!HANDLED.has(eventType)) {
    await db.webhookEvent.update({
      where: { transmissionId: headers.transmissionId },
      data: { processedAt: new Date(), error: 'ignored: unhandled event type' },
    });
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  try {
    // One-time purchases settle through the Orders path. This is the safety
    // net: if the buyer closes the tab before /checkout/return loads, the
    // webhook still captures and grants. settleOrder is idempotent, so the two
    // racing is harmless.
    if (eventType === 'CHECKOUT.ORDER.APPROVED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      // On CHECKOUT.ORDER.APPROVED the resource id is the order. On
      // PAYMENT.CAPTURE.COMPLETED it is the capture, and the order id is on
      // supplementary_data.
      const orderId =
        eventType === 'CHECKOUT.ORDER.APPROVED'
          ? event.resource?.id
          : event.resource?.supplementary_data?.related_ids?.order_id;

      if (!orderId) {
        await db.webhookEvent.update({
          where: { transmissionId: headers.transmissionId },
          data: { processedAt: new Date(), error: 'no order id on the event' },
        });
        return NextResponse.json({ ok: true });
      }

      const settled = await settleOrder(orderId);
      await db.webhookEvent.update({
        where: { transmissionId: headers.transmissionId },
        data: {
          processedAt: new Date(),
          error: settled.ok ? null : settled.reason,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // On subscription events the resource id IS the subscription. On
    // PAYMENT.SALE.COMPLETED — the recurring charge — it is billing_agreement_id.
    const subscriptionId =
      eventType === 'PAYMENT.SALE.COMPLETED'
        ? event.resource?.billing_agreement_id
        : event.resource?.id;

    if (!subscriptionId) {
      await db.webhookEvent.update({
        where: { transmissionId: headers.transmissionId },
        data: { processedAt: new Date(), error: 'no subscription id on the event' },
      });
      return NextResponse.json({ ok: true });
    }

    const result = await syncSubscription(subscriptionId);

    await db.webhookEvent.update({
      where: { transmissionId: headers.transmissionId },
      data: {
        processedAt: new Date(),
        error: result.ok ? null : (result.reason ?? 'sync failed'),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    await db.webhookEvent.update({
      where: { transmissionId: headers.transmissionId },
      data: { processedAt: new Date(), error: e instanceof Error ? e.message : String(e) },
    });
    // Still 200 — see the note at the top.
    return NextResponse.json({ ok: true, handled: false });
  }
}

/** PayPal probes some endpoints with GET; make it explicit this is POST-only. */
export function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
