'use client';

import { useActionState } from 'react';

import type { ResetState } from './actions';

export function ResetForm({
  action,
  token,
}: {
  action: (prev: ResetState, formData: FormData) => Promise<ResetState>;
  token: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction} noValidate>
      {state.error ? <p className="alert alert--error" role="alert">{state.error}</p> : null}
      <input type="hidden" name="token" value={token} />
      <div className="field">
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password"
               autoComplete="new-password" minLength={10} required />
        <p className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>At least 10 characters.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="confirm">Confirm new password</label>
        <input className="input" id="confirm" name="confirm" type="password"
               autoComplete="new-password" minLength={10} required />
      </div>
      <button className="btn btn--dark btn--block" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}
