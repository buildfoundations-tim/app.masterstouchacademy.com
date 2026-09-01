'use client';

import { useActionState } from 'react';

import type { SignUpState } from './actions';

export function SignUpForm({
  action,
}: {
  action: (prev: SignUpState, formData: FormData) => Promise<SignUpState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  // Shown when the address already had an account. Deliberately identical in
  // tone to a successful signup — see the note in actions.ts.
  if (state.sent) {
    return (
      <div className="card" style={{ padding: 26 }}>
        <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
          Check your email
        </h2>
        <p className="muted" style={{ lineHeight: 1.7, marginBottom: 18 }}>
          We&rsquo;ve sent a message to that address with what to do next. If it doesn&rsquo;t
          arrive within a few minutes, check your spam folder.
        </p>
        <a className="btn btn--outline btn--block" href="/signin">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="firstName">First name</label>
          <input className="input" id="firstName" name="firstName" autoComplete="given-name" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="lastName">Last name</label>
          <input className="input" id="lastName" name="lastName" autoComplete="family-name" required />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email"
               placeholder="you@company.com" required />
      </div>

      <div className="field">
        <label className="label" htmlFor="company">Company <span className="faint">(optional)</span></label>
        <input className="input" id="company" name="company" autoComplete="organization" />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password"
               autoComplete="new-password" minLength={10} required />
        <p className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
          At least 10 characters. Length matters more than symbols.
        </p>
      </div>

      <button className="btn btn--dark btn--block" type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </button>

      <p className="faint" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
        Community membership is free and stays free. You can upgrade later.
      </p>
    </form>
  );
}
