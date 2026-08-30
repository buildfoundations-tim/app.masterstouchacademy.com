'use client';

import { useActionState } from 'react';

import type { BuyState } from './actions';

/**
 * Shared purchase button. Carries only what is being bought — never a price;
 * the server prices it. See src/lib/orders.ts.
 */
export function BuyButton({
  action,
  fields,
  label,
  pendingLabel = 'Opening PayPal…',
  className = 'btn btn--dark btn--block',
  disabled = false,
  disabledLabel,
}: {
  action: (prev: BuyState, formData: FormData) => Promise<BuyState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  disabledLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={className} type="submit" disabled={pending || disabled}>
        {pending ? pendingLabel : disabled ? (disabledLabel ?? label) : label}
      </button>
      {state.error ? (
        <p className="alert alert--error" style={{ marginTop: 10, marginBottom: 0 }} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
