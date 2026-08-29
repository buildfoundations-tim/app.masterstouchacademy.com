import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { TIER_LABEL } from '@/lib/access';
import { syncSubscription } from '@/lib/subscriptions';

export const metadata = { title: 'Membership' };

/**
 * Where PayPal sends the member after they approve.
 *
 * The subscription_id in the query string is only a hint. It is checked against
 * a row we created for THIS member, and the real state is then read back from
 * PayPal — pasting someone else's subscription id here must not grant anything.
 *
 * The webhook is the authoritative path; this page exists so the member sees
 * the right thing immediately instead of waiting on delivery.
 */
export default async function MembershipReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ subscription_id?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { subscription_id: subscriptionId } = await searchParams;

  let outcome: 'active' | 'pending' | 'unknown' = 'unknown';
  let tier = user.tier;

  if (subscriptionId) {
    const owned = await db.subscription.findFirst({
      where: { paypalSubscriptionId: subscriptionId, userId: user.id },
      select: { id: true },
    });

    if (owned) {
      const result = await syncSubscription(subscriptionId);
      if (result.ok) {
        tier = result.tier ?? user.tier;
        outcome = result.status === 'active' ? 'active' : 'pending';
      }
    }
  }

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Membership</h1>
      </header>

      <div className="page" style={{ maxWidth: 620 }}>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          {outcome === 'active' ? (
            <>
              <span className="badge badge--done" style={{ fontSize: 12 }}>
                Active
              </span>
              <h2 className="display" style={{ fontSize: 30, margin: '16px 0 10px' }}>
                Welcome to {TIER_LABEL[tier]}
              </h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                Your membership is live. The continuing education library is open to you now.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link className="btn btn--dark" href="/classroom">
                  Go to the classroom
                </Link>
                <Link className="btn btn--outline" href="/membership">
                  Membership settings
                </Link>
              </div>
            </>
          ) : outcome === 'pending' ? (
            <>
              <h2 className="display" style={{ fontSize: 28, marginBottom: 10 }}>
                Almost there
              </h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                PayPal has your approval but hasn&rsquo;t activated the subscription yet. This
                usually takes a few seconds. Refresh this page, or check the membership page in a
                moment — your tier updates automatically once PayPal confirms.
              </p>
              <Link className="btn btn--dark" href="/membership">
                Membership settings
              </Link>
            </>
          ) : (
            <>
              <h2 className="display" style={{ fontSize: 28, marginBottom: 10 }}>
                We couldn&rsquo;t confirm that
              </h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                We have no record of that subscription against your account. If you completed a
                payment, nothing is lost — it will apply as soon as PayPal notifies us. Check the
                membership page, and get in touch if it hasn&rsquo;t appeared shortly.
              </p>
              <Link className="btn btn--dark" href="/membership">
                Back to membership
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
