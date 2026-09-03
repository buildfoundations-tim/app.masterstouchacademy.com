'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { centsToValue } from '@/lib/billing';
import { createOrder, orderApprovalUrl, paypalConfigured, createSubscription, approvalUrl } from '@/lib/paypal';
import { findPlanByKey, paypalPlanId } from '@/lib/billing';
import { recordPendingSubscription } from '@/lib/subscriptions';
import {
  addCourseToCart,
  addSeatToCart,
  addMembershipToCart,
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
  } else if (kind === 'membership') {
    const planKey = String(formData.get('planKey') ?? '');
    if (!planKey) return { error: 'Pick a plan.' };
    result = await addMembershipToCart(user.id, planKey);
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
  revalidatePath('/membership');
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


/**
 * Start the membership sitting in the cart.
 *
 * Separate from checkoutCart because PayPal cannot take a subscription and a
 * one-off order in one transaction — Subscriptions and Orders are different
 * APIs. The member approves the membership first; once PayPal reports it
 * active the tier moves, and the rest of the cart is then genuinely priced at
 * the rate the cart was already showing.
 */
export async function startMembershipFromCart(
  _prev: CheckoutState,
  _formData: FormData
): Promise<CheckoutState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  if (!paypalConfigured()) return { error: 'Payments are not configured yet.' };

  const line = await db.cartItem.findFirst({
    where: { userId: user.id, kind: 'membership' },
    select: { planKey: true },
  });
  if (!line?.planKey) return { error: 'There is no membership in your cart.' };

  const plan = findPlanByKey(line.planKey);
  if (!plan) return { error: 'That plan is no longer available.' };

  const planId = paypalPlanId(plan.key);
  if (!planId) return { error: 'That plan is not configured at PayPal yet.' };

  const existing = await db.subscription.findFirst({
    where: { userId: user.id, status: 'active' },
    select: { id: true },
  });
  if (existing) {
    return {
      error:
        'You already have an active membership. Cancel it before starting a different plan, ' +
        'or get in touch and we will move you across without a gap.',
    };
  }

  const origin = await appOrigin();

  let sub;
  try {
    sub = await createSubscription({
      planId,
      customId: user.id,
      // Back to the cart, so the remaining items can be bought at the new rate.
      returnUrl: `${origin}/cart?membership=started`,
      cancelUrl: `${origin}/cart?membership=cancelled`,
      subscriberEmail: user.email,
      subscriberName: { given_name: user.firstName, surname: user.lastName },
    });
  } catch {
    return { error: 'PayPal could not start that subscription. Please try again.' };
  }

  await recordPendingSubscription({
    userId: user.id,
    paypalSubscriptionId: sub.id,
    paypalPlanId: planId,
    planKey: plan.key,
  });

  const approve = approvalUrl(sub);
  if (!approve) return { error: 'PayPal did not return an approval link.' };

  redirect(approve);
}
