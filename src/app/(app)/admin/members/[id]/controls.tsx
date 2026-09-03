'use client';

import { useActionState } from 'react';

import { adjustTier, grant } from '../actions';
import { EMPTY, type MemberActionState } from '../state';

type Action = (prev: MemberActionState, formData: FormData) => Promise<MemberActionState>;

function Feedback({ state }: { state: MemberActionState }) {
  if (state.error) {
    return (
      <p className="alert alert--error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.note) {
    return (
      <p className="alert alert--info" role="status">
        {state.note}
      </p>
    );
  }
  return null;
}

/**
 * Set or clear a hand-set tier.
 *
 * The two things this has to make obvious, because getting either wrong costs
 * a member their access: that an override *replaces* what they pay for, and
 * what clearing it would drop them to.
 */
export function TierControl({
  userId,
  currentTier,
  paidTier,
  override,
  overrideReason,
  tierLabels,
}: {
  userId: string;
  currentTier: number;
  paidTier: number;
  override: number | null;
  overrideReason: string | null;
  tierLabels: Record<number, string>;
}) {
  const [state, formAction, pending] = useActionState<MemberActionState, FormData>(
    adjustTier as Action,
    EMPTY
  );

  return (
    <div className="card admin-panel">
      <h2 className="admin-panel__title">Tier</h2>

      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        They are on <strong>{tierLabels[currentTier]}</strong>.{' '}
        {override !== null ? (
          <>
            That is set by hand. Their subscriptions alone would put them on{' '}
            <strong>{tierLabels[paidTier]}</strong>.
            {overrideReason ? <> Reason given: “{overrideReason}”.</> : null}
          </>
        ) : (
          <>It follows their subscriptions, and changes when those do.</>
        )}
      </p>

      <Feedback state={state} />

      {/* Keyed on the saved override so the fields remount after an action.
          `defaultValue` only applies on mount: without this the select snapped
          back to "follow their subscriptions" after a save, which read as "no
          override" when there was one — and saving again would have cleared it. */}
      <form action={formAction} className="admin-form" key={String(override)}>
        <input type="hidden" name="userId" value={userId} />

        <label className="field">
          <span className="label">Set tier by hand</span>
          <select className="input" name="tier" defaultValue={override ?? ''}>
            <option value="">Don&rsquo;t — follow their subscriptions</option>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t}>
                {tierLabels[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="label">Why</span>
          <input
            className="input"
            name="reason"
            defaultValue={overrideReason ?? ''}
            placeholder="Comped for the Cleveland seminar"
          />
          <span className="hint">
            Shown on this screen later, so whoever reads it next knows whether it still applies.
          </span>
        </label>

        <button className="btn btn--dark btn--sm" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save tier'}
        </button>
      </form>
    </div>
  );
}

/** Give a member a course outright. */
export function GrantControl({
  userId,
  courses,
}: {
  userId: string;
  courses: Array<{ id: string; code: string; title: string }>;
}) {
  const [state, formAction, pending] = useActionState<MemberActionState, FormData>(
    grant as Action,
    EMPTY
  );

  return (
    <div className="card admin-panel">
      <h2 className="admin-panel__title">Grant a course</h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
        Opens a course without a purchase, with no expiry. It sits alongside anything they bought,
        so removing it later cannot take away a course they paid for.
      </p>

      <Feedback state={state} />

      <form action={formAction} className="admin-form admin-form--row">
        <input type="hidden" name="userId" value={userId} />
        <select className="input" name="courseId" defaultValue="">
          <option value="" disabled>
            Pick a course…
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
        <button className="btn btn--dark btn--sm" type="submit" disabled={pending}>
          {pending ? 'Granting…' : 'Grant'}
        </button>
      </form>
    </div>
  );
}
