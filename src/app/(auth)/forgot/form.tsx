'use client';

import { useActionState } from 'react';

import type { ForgotState } from './actions';

export function ForgotForm({
  action,
}: {
  action: (prev: ForgotState, formData: FormData) => Promise<ForgotState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  if (state.sent) {
    return (
      <div className="card" style={{ padding: 26 }}>
        <h2 className="display" style={{ fontSize: 22, marginBottom: 10 }}>Check your email</h2>
        <p className="muted" style={{ lineHeight: 1.7, marginBottom: 18 }}>
          If that address has an account, a reset link is on its way. It works once and expires
          in an hour.
        </p>
        <a className="btn btn--outline btn--block" href="/signin">Back to sign in</a>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate>
      {state.error ? <p className="alert alert--error" role="alert">{state.error}</p> : null}
      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email"
               placeholder="you@company.com" required />
      </div>
      <button className="btn btn--dark btn--block" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </button>
    </form>
  );
}
