import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { settleOrder } from '@/lib/orders';

const Body = z.object({ orderId: z.string().min(1) });

/**
 * Capture and fulfil, for the inline (JS SDK) flow.
 *
 * The order id comes from the browser, so it is checked against an Order row
 * belonging to the caller before anything happens — otherwise this would
 * capture and grant against someone else's order on request.
 *
 * settleOrder does the rest and is idempotent, so this racing the
 * PAYMENT.CAPTURE.COMPLETED webhook is harmless: whichever arrives first
 * captures and grants, the other finds fulfilledAt set and stops.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
  }

  // The ownership check. Without it, any signed-in member could settle any
  // order by id.
  const owned = await db.order.findFirst({
    where: { paypalOrderId: parsed.data.orderId, userId: user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: 'no such order on your account' }, { status: 404 });
  }

  const result = await settleOrder(parsed.data.orderId);

  if (!result.ok) {
    // Deliberately vague to the browser; the reason is on the Order row.
    return NextResponse.json({ error: 'payment could not be completed', reason: result.reason }, { status: 402 });
  }

  return NextResponse.json({ ok: true, alreadyDone: result.alreadyDone });
}
