'use client';

import { useActionState } from 'react';

import type { CheckoutState } from './actions';

type PlanCard = {
  key: string;
  tier: number;
  label: string;
  blurb: string;
  perMonthCents: number;
  chargeCents: number;
  interval: string;
  features: string[];
  purchasable: boolean;
  isCurrent: boolean;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function PlanPicker({
  action,
  plans,
  interval,
  currentTier,
}: {
  action: (prev: CheckoutState, formData: FormData) => Promise<CheckoutState>;
  plans: PlanCard[];
  interval: string;
  currentTier: number;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="billing-toggle">
        <a
          href="/membership?interval=month"
          aria-current={interval === 'month' ? 'true' : undefined}
        >
          Monthly
        </a>
        <a
          href="/membership?interval=year"
          aria-current={interval === 'year' ? 'true' : undefined}
        >
          Yearly — two months free
        </a>
      </div>

      <div className="plans">
        {plans.map((plan) => (
          <div key={plan.key} className={`plan${plan.tier === 3 ? ' plan--featured' : ''}`}>
            {plan.tier === 3 ? <span className="badge plan__flag">Most popular</span> : null}

            <h2 className="display" style={{ fontSize: 26 }}>
              {plan.label}
            </h2>
            <p className="plan__blurb">{plan.blurb}</p>

            <p className="plan__price">{money(plan.perMonthCents)}</p>
            <p className="plan__period">
              {plan.interval === 'year'
                ? `per month, billed yearly (${money(plan.chargeCents)})`
                : 'per month, 3-month minimum'}
            </p>

            <ul className="plan__features">
              {plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            {plan.isCurrent ? (
              <span className="btn btn--outline btn--block" aria-disabled="true">
                Your current plan
              </span>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="planKey" value={plan.key} />
                <button
                  className={`btn btn--block ${plan.tier === 3 ? 'btn--gold' : 'btn--dark'}`}
                  type="submit"
                  disabled={pending || !plan.purchasable}
                  title={plan.purchasable ? undefined : 'PayPal is not configured for this plan yet'}
                >
                  {pending
                    ? 'Opening PayPal…'
                    : !plan.purchasable
                      ? 'Unavailable'
                      : plan.tier > currentTier
                        ? `Upgrade to ${plan.label}`
                        : `Switch to ${plan.label}`}
                </button>
              </form>
            )}

            <p className="plan__paypal">Secure checkout via PayPal</p>
          </div>
        ))}
      </div>
    </>
  );
}
