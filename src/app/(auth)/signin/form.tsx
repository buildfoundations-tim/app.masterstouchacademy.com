'use client';

import { useActionState, useState } from 'react';

import type { SignInState } from './actions';

export function SignInForm({
  action,
  next,
}: {
  action: (prev: SignInState, formData: FormData) => Promise<SignInState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} noValidate>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <div style={{ position: 'relative' }}>
          <input
            className="input"
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            style={{ paddingRight: 62 }}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 0,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--gold-deep)',
            }}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <button className="btn btn--dark btn--block" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
