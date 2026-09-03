'use client';

import { useActionState } from 'react';

import type { CheckoutState } from './actions';

export function CheckoutButton({
  action,
  disabled,
  label,
}: {
  action: (prev: CheckoutState, formData: FormData) => Promise<CheckoutState>;
  disabled: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      {state.error ? (
        <p className="alert alert--error" style={{ fontSize: 12.5 }} role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="btn btn--dark btn--block" type="submit" disabled={pending || disabled}>
        {pending ? 'Opening PayPal…' : label}
      </button>
    </form>
  );
}
