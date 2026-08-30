'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { centsToValue } from '@/lib/billing';
import { createOrder, orderApprovalUrl, paypalConfigured } from '@/lib/paypal';
import { createLocalOrder, pricePurchase, type PurchaseRequest } from '@/lib/orders';

export type BuyState = { error: string | null };

async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Start a one-time purchase.
 *
 * The form supplies only what is being bought. The price comes from
 * pricePurchase(), which reads the catalog and applies the buyer's tier
 * discount server-side.
 */
export async function startPurchase(_prev: BuyState, formData: FormData): Promise<BuyState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  if (!paypalConfigured()) {
    return { error: 'Payments are not configured yet. See docs/paypal-setup.md.' };
  }

  const kind = String(formData.get('kind') ?? '');
  let req: PurchaseRequest;

  if (kind === 'course') {
    const courseId = String(formData.get('courseId') ?? '');
    if (!courseId) return { error: 'Nothing to buy.' };
    req = { kind: 'course', courseId };
  } else if (kind === 'class_seat') {
    const classId = String(formData.get('classId') ?? '');
    const seatMode = String(formData.get('seatMode') ?? '');
    if (!classId || (seatMode !== 'inperson' && seatMode !== 'virtual')) {
      return { error: 'Pick a seat format.' };
    }
    req = { kind: 'class_seat', classId, seatMode };
  } else {
    return { error: 'Nothing to buy.' };
  }

  const priced = await pricePurchase(user, req);
  if (!priced.ok) return { error: priced.reason };

  const origin = await appOrigin();
  const value = centsToValue(priced.line.unitCents);

  let remote;
  try {
    remote = await createOrder({
      customId: user.id,
      // Human-readable and unique enough to find in PayPal's dashboard.
      invoiceId: `MTA-${Date.now().toString(36).toUpperCase()}`,
      total: value,
      items: [{ name: priced.line.description, value }],
      returnUrl: `${origin}/checkout/return`,
      cancelUrl: `${origin}/checkout/cancelled`,
    });
  } catch {
    return { error: 'PayPal could not start that purchase. Please try again.' };
  }

  await createLocalOrder(user.id, priced.line, remote.id);

  const approve = orderApprovalUrl(remote);
  if (!approve) return { error: 'PayPal did not return an approval link.' };

  redirect(approve);
}
