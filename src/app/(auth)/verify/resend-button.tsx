'use client';

import { useActionState } from 'react';

import type { ResendState } from './actions';

export function ResendButton({
  action,
}: {
  action: (prev: ResendState, formData: FormData) => Promise<ResendState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  if (state.sent) {
    return (
      <p className="alert alert--info" role="status">
        Sent. Check your inbox — the new link works once and expires in 24 hours.
      </p>
    );
  }

  return (
    <form action={formAction}>
      {state.error ? <p className="alert alert--error" role="alert">{state.error}</p> : null}
      <button className="btn btn--dark btn--block" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send a new link'}
      </button>
    </form>
  );
}
