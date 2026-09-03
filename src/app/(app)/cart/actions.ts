'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { centsToValue } from '@/lib/billing';
import { createOrder, orderApprovalUrl, paypalConfigured } from '@/lib/paypal';
import {
  addCourseToCart,
  addSeatToCart,
  removeFromCart,
  pricedForCheckout,
} from '@/lib/cart';

export type CartActionState = { error: string | null; added?: boolean };

async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function addToCart(
  _prev: CartActionState,
  formData: FormData
): Promise<CartActionState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const kind = String(formData.get('kind') ?? '');
  let result;

  if (kind === 'course') {
    const courseId = String(formData.get('courseId') ?? '');
    if (!courseId) return { error: 'Nothing to add.' };
    result = await addCourseToCart(user, courseId);
  } else if (kind === 'class_seat') {
    const classId = String(formData.get('classId') ?? '');
    const seatMode = String(formData.get('seatMode') ?? '');
    if (!classId || (seatMode !== 'inperson' && seatMode !== 'virtual')) {
      return { error: 'Pick a seat format.' };
    }
    result = await addSeatToCart(user, classId, seatMode);
  } else {
    return { error: 'Nothing to add.' };
  }

  if (!result.ok) return { error: result.reason };

  revalidatePath('/cart');
  revalidatePath('/classroom');
  revalidatePath('/schedule');
  return { error: null, added: true };
}

export async function removeItem(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  await removeFromCart(user.id, String(formData.get('cartItemId') ?? ''));
  revalidatePath('/cart');
}

export type CheckoutState = { error: string | null };

/**
 * Check out the whole cart as a single PayPal order.
 *
 * Everything is re-priced here rather than trusting what the page showed — the
 * cart may have been open for an hour. Lines that have become unbuyable are
 * left behind rather than failing the whole checkout, and the member is told.
 */
export async function checkoutCart(
  _prev: CheckoutState,
  _formData: FormData
): Promise<CheckoutState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  if (!paypalConfigured()) {
    return { error: 'Payments are not configured yet.' };
  }

  const { lines, totalCents, skipped } = await pricedForCheckout(user);

  if (lines.length === 0) {
    return {
      error: skipped.length
        ? `Nothing in your cart can be bought right now. ${skipped[0]}`
        : 'Your cart is empty.',
    };
  }

  const origin = await appOrigin();
  const total = centsToValue(totalCents);

  let remote;
  try {
    remote = await createOrder({
      customId: user.id,
      invoiceId: `MTA-${Date.now().toString(36).toUpperCase()}`,
      total,
      items: lines.map((l) => ({
        name: l.description,
        value: centsToValue(l.unitCents),
      })),
      returnUrl: `${origin}/checkout/return`,
      cancelUrl: `${origin}/checkout/cancelled`,
    });
  } catch {
    return { error: 'PayPal could not start that purchase. Please try again.' };
  }

  // One Order row carrying every line. settleOrder already loops over items,
  // so fulfilment grants each of them under the same idempotency guard.
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

  const approve = orderApprovalUrl(remote);
  if (!approve) return { error: 'PayPal did not return an approval link.' };

  redirect(approve);
}
