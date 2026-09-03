import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { centsToValue } from '@/lib/billing';
import { createOrder, paypalConfigured } from '@/lib/paypal';
import { pricedForCheckout } from '@/lib/cart';

/**
 * Create a PayPal order for the caller's cart, for the inline (JS SDK) flow.
 *
 * The SDK's createOrder callback hits this and gets back an id. It sends
 * nothing but the request itself — **the amount is computed here**, from the
 * cart, the catalog, and the caller's tier. There is no field in this endpoint
 * that a browser could use to influence what it is charged.
 *
 * Same pricing path as the redirect flow, so the two cannot drift apart.
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  if (!paypalConfigured()) {
    return NextResponse.json({ error: 'payments are not configured' }, { status: 503 });
  }

  const { lines, totalCents, skipped } = await pricedForCheckout(user);

  if (lines.length === 0) {
    return NextResponse.json(
      {
        error: skipped.length
          ? `Nothing in your cart can be bought right now. ${skipped[0]}`
          : 'Your cart is empty.',
      },
      { status: 400 }
    );
  }

  let remote;
  try {
    remote = await createOrder({
      customId: user.id,
      invoiceId: `MTA-${Date.now().toString(36).toUpperCase()}`,
      total: centsToValue(totalCents),
      items: lines.map((l) => ({ name: l.description, value: centsToValue(l.unitCents) })),
      // Unused by the inline flow — PayPal requires them, and they are the
      // correct destinations if the buyer is ever bounced out to the web flow.
      returnUrl: `${process.env.APP_URL ?? ''}/checkout/return`,
      cancelUrl: `${process.env.APP_URL ?? ''}/checkout/cancelled`,
    });
  } catch {
    return NextResponse.json({ error: 'PayPal could not start that purchase.' }, { status: 502 });
  }

  await db.order.create({
    data: {
      userId: user.id,
      paypalOrderId: remote.id,
      status: 'created',
      totalCents,
      items: {
        create: lines.map((l) => ({
          kind: l.kind,
          courseId: l.courseId ?? null,
          classId: l.classId ?? null,
          seatMode: l.seatMode ?? null,
          description: l.description,
          listCents: l.listCents,
          unitCents: l.unitCents,
        })),
      },
    },
  });

  return NextResponse.json({ id: remote.id });
}
