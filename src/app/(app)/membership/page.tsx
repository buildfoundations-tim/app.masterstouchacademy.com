import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { TIER_LABEL, TIER } from '@/lib/access';
import { PLANS, paypalPlanId, planIdEnvName, type Interval } from '@/lib/billing';
import { paypalConfigured, paypalEnv } from '@/lib/paypal';
import { activeSubscription } from '@/lib/subscriptions';
import { money, formatDate } from '@/lib/format';
import { startCheckout, cancelMembership } from './actions';
import { PlanPicker } from './plan-picker';

export const metadata = { title: 'Membership' };

const FEATURES: Record<number, string[]> = {
  [TIER.PRO]: [
    'The whole CEC library, on demand and live stream',
    'All books in eBook format',
    '2 meetups a month with Tom',
    '10% off every IICRC class and the marketplace',
  ],
  [TIER.PRO_PLUS]: [
    'Everything in Pro',
    'Ask Captain Carpet AI, unlimited',
    '4 consulting sessions a year',
    '20% off every IICRC class and the marketplace',
  ],
  [TIER.CREW_LEADER]: [
    'Everything in Pro+',
    '5 crew seats included, add more anytime',
    'Crew progress and certification tracking',
    '20% off for every seat, one invoice',
  ],
};

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string; interval?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { cancelled, interval: intervalParam } = await searchParams;
  const interval: Interval = intervalParam === 'year' ? 'year' : 'month';

  const current = await activeSubscription(user.id);
  const configured = paypalConfigured();

  const plans = PLANS.filter((p) => p.interval === interval);
  const missingIds = PLANS.filter((p) => !paypalPlanId(p.key));

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Membership</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          You&rsquo;re on {TIER_LABEL[user.tier]}
        </span>
      </header>

      <div className="page">
        {cancelled ? (
          <p className="alert alert--info">
            Checkout was cancelled — nothing was charged. Your membership is unchanged.
          </p>
        ) : null}

        {!configured ? (
          <p className="alert alert--error">
            <strong>PayPal is not configured.</strong> Plans are shown for reference but cannot be
            purchased. Add <code>PAYPAL_CLIENT_ID</code> and <code>PAYPAL_CLIENT_SECRET</code> to the
            environment — see <code>docs/paypal-setup.md</code>.
          </p>
        ) : missingIds.length > 0 ? (
          <p className="alert alert--error">
            <strong>{missingIds.length} plan(s) have no PayPal id yet.</strong> Run{' '}
            <code>npm run paypal:setup</code> and paste the printed ids into the environment (
            {missingIds.map((p) => planIdEnvName(p.key)).join(', ')}).
          </p>
        ) : paypalEnv() === 'sandbox' ? (
          <p className="alert alert--info">
            <strong>PayPal sandbox.</strong> Checkout uses test money — sign in at PayPal with a
            sandbox buyer account. No real payment is taken.
          </p>
        ) : null}

        {current ? (
          <section className="card" style={{ padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <span className="badge badge--done">Active</span>
                <h2 className="display" style={{ fontSize: 26, margin: '10px 0 6px' }}>
                  {TIER_LABEL[current.tier]}
                </h2>
                <p className="muted" style={{ fontSize: 13.5 }}>
                  {money(current.priceCents)} billed {current.interval === 'year' ? 'yearly' : 'monthly'}
                  {current.currentPeriodEnd
                    ? ` · renews ${formatDate(current.currentPeriodEnd)}`
                    : ''}
                </p>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
                  PayPal subscription {current.paypalSubscriptionId}
                </p>
              </div>
              <form action={cancelMembership}>
                <input type="hidden" name="paypalSubscriptionId" value={current.paypalSubscriptionId} />
                <button className="btn btn--outline btn--danger btn--sm" type="submit">
                  Cancel membership
                </button>
              </form>
            </div>
            <p className="faint" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
              Cancelling stops future billing. Access continues until the end of the period you have
              already paid for.
            </p>
          </section>
        ) : null}

        <PlanPicker
          action={startCheckout}
          interval={interval}
          plans={plans.map((p) => ({
            key: p.key,
            tier: p.tier,
            label: p.label,
            blurb: p.blurb,
            perMonthCents: p.perMonthCents,
            chargeCents: p.chargeCents,
            interval: p.interval,
            features: FEATURES[p.tier] ?? [],
            purchasable: configured && Boolean(paypalPlanId(p.key)),
            isCurrent: current?.tier === p.tier && current?.interval === p.interval,
          }))}
          currentTier={user.tier}
        />

        <p className="faint" style={{ fontSize: 12, marginTop: 20, lineHeight: 1.7, maxWidth: 700 }}>
          Community stays free. Paid plans are advertised with a three-month minimum term — note
          that PayPal does not enforce a minimum commitment, so a member can cancel from their own
          PayPal account at any time. If that term matters commercially it needs to be handled in
          your terms rather than by the billing system.
        </p>
      </div>
    </>
  );
}
