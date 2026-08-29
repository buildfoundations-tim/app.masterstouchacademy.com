'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { findPlanByKey, paypalPlanId } from '@/lib/billing';
import { approvalUrl, cancelSubscription, createSubscription, paypalConfigured } from '@/lib/paypal';
import { recordPendingSubscription, syncSubscription } from '@/lib/subscriptions';

export type CheckoutState = { error: string | null };

/** The app's own origin, for PayPal's return and cancel URLs. */
async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Start a subscription: create it at PayPal, remember it as pending, then send
 * the member off to approve it.
 *
 * No tier is granted here. The member does not hold the plan until PayPal says
 * the subscription is ACTIVE — see syncSubscription.
 */
export async function startCheckout(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  if (!paypalConfigured()) {
    return { error: 'Payments are not configured yet. See docs/paypal-setup.md.' };
  }

  const planKey = String(formData.get('planKey') ?? '');
  const plan = findPlanByKey(planKey);
  if (!plan) return { error: 'That plan is not available.' };

  const planId = paypalPlanId(plan.key);
  if (!planId) {
    return { error: `This plan has no PayPal id configured yet. Run npm run paypal:setup.` };
  }

  // Refuse a second subscription rather than letting someone pay twice.
  const existing = await db.subscription.findFirst({
    where: { userId: user.id, status: 'active' },
    select: { tier: true },
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
      returnUrl: `${origin}/membership/return`,
      cancelUrl: `${origin}/membership?cancelled=1`,
      subscriberEmail: user.email,
      subscriberName: { given_name: user.firstName, surname: user.lastName },
    });
  } catch (e) {
    return {
      error:
        e instanceof Error && e.message.includes('auth failed')
          ? 'Could not reach PayPal — check the API credentials.'
          : 'PayPal could not start that subscription. Please try again.',
    };
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

/**
 * Cancel at PayPal, then reconcile.
 *
 * Deliberately does not write the tier directly — syncSubscription re-reads the
 * real state, so a cancel that silently failed at PayPal does not leave us
 * showing a member as downgraded while they are still being billed.
 */
export async function cancelMembership(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const id = String(formData.get('paypalSubscriptionId') ?? '');

  // Only ever cancel a subscription that belongs to the caller.
  const owned = await db.subscription.findFirst({
    where: { paypalSubscriptionId: id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return;

  try {
    await cancelSubscription(id, 'Cancelled by the member from the academy app.');
  } catch {
    // Fall through to the sync — if it was already cancelled at PayPal, that
    // read is what puts us back in step.
  }

  await syncSubscription(id);
  revalidatePath('/membership');
}
