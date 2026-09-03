'use client';

import { useActionState } from 'react';

import type { CartActionState } from './actions';

/**
 * Add to cart. Carries only what is being added — never a price; the server
 * prices it. See src/lib/pricing.ts.
 */
export function AddToCartButton({
  action,
  fields,
  label,
  className = 'btn btn--dark',
  disabled = false,
  disabledLabel,
}: {
  action: (prev: CartActionState, formData: FormData) => Promise<CartActionState>;
  fields: Record<string, string>;
  label: string;
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
        {pending ? 'Adding…' : state.added ? 'In your cart ✓' : disabled ? (disabledLabel ?? label) : label}
      </button>
      {state.error ? (
        <p className="alert alert--error" style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5 }} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
