'use client';

import { useState } from 'react';

import { PayPalButtons } from './paypal-buttons';
import { CheckoutButton } from './checkout-button';
import type { CheckoutState } from './actions';

/**
 * Checkout, inline first with the redirect as a fallback.
 *
 * The redirect form is always rendered — it is a plain server action and works
 * with JavaScript disabled. It is de-emphasised while the SDK is healthy so
 * there are not two competing primary buttons, and promoted if the SDK fails.
 */
export function CheckoutPanel({
  action,
  clientId,
  disabled,
  label,
}: {
  action: (prev: CheckoutState, formData: FormData) => Promise<CheckoutState>;
  clientId: string | null;
  disabled: boolean;
  label: string;
}) {
  const [needFallback, setNeedFallback] = useState(!clientId);

  return (
    <div>
      {clientId && !disabled ? (
        <PayPalButtons clientId={clientId} disabled={disabled} onFallbackNeeded={setNeedFallback} />
      ) : null}

      {needFallback || disabled ? (
        <CheckoutButton action={action} disabled={disabled} label={label} />
      ) : (
        <details className="checkout-alt">
          <summary>Trouble with the buttons?</summary>
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 10px', lineHeight: 1.6 }}>
            This takes you to PayPal and brings you back.
          </p>
          <CheckoutButton action={action} disabled={disabled} label={label} />
        </details>
      )}
    </div>
  );
}
