'use client';

import { useActionState } from 'react';

import type { ClassFormState } from './actions';

type Course = { id: string; code: string; title: string };

type Editing = {
  id: string;
  courseId: string;
  title: string;
  mode: string;
  startDate: Date;
  endDate: Date;
  dateLabel: string;
  location: string;
  note: string | null;
  seatsTotal: number;
  published: boolean;
  inPersonPriceCents: number | null;
  virtualPriceCents: number | null;
} | null;

/** Date -> yyyy-mm-dd for <input type="date">, in UTC to match how it was stored. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dollars(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

export function ClassForm({
  action,
  courses,
  editing,
}: {
  action: (prev: ClassFormState, formData: FormData) => Promise<ClassFormState>;
  courses: Course[];
  editing: Editing;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  // key remounts the form when switching between add and edit, so the inputs
  // pick up the new defaults instead of keeping the previous row's values.
  return (
    <form action={formAction} key={editing?.id ?? 'new'}>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="alert alert--success" role="status">
          {state.ok}
        </p>
      ) : null}

      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

      <div className="field">
        <label className="label" htmlFor="courseId">
          Course
        </label>
        <select className="input" id="courseId" name="courseId" defaultValue={editing?.courseId ?? ''} required>
          <option value="" disabled>
            Choose a course
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.title}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="label" htmlFor="title">
          Title shown to members
        </label>
        <input
          className="input"
          id="title"
          name="title"
          defaultValue={editing?.title ?? ''}
          placeholder="IICRC Water Damage Restoration Technician (WRT)"
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="startDate">
            Starts
          </label>
          <input
            className="input"
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={editing ? isoDate(editing.startDate) : ''}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="endDate">
            Ends
          </label>
          <input
            className="input"
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={editing ? isoDate(editing.endDate) : ''}
            required
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="dateLabel">
          Date label
        </label>
        <input
          className="input"
          id="dateLabel"
          name="dateLabel"
          defaultValue={editing?.dateLabel ?? ''}
          placeholder="Sep 9–11, 2026"
          required
        />
        <p className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
          Written out as it should read on the site, en dash and all.
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor="mode">
          Format
        </label>
        <select className="input" id="mode" name="mode" defaultValue={editing?.mode ?? 'hybrid'}>
          <option value="hybrid">Classroom or live stream</option>
          <option value="inperson">In-person only</option>
          <option value="virtual">Live stream only</option>
        </select>
      </div>

      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="inPersonPrice">
            Classroom price
          </label>
          <input
            className="input"
            id="inPersonPrice"
            name="inPersonPrice"
            inputMode="decimal"
            defaultValue={dollars(editing?.inPersonPriceCents ?? null)}
            placeholder="450.00"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="virtualPrice">
            Live-stream price
          </label>
          <input
            className="input"
            id="virtualPrice"
            name="virtualPrice"
            inputMode="decimal"
            defaultValue={dollars(editing?.virtualPriceCents ?? null)}
            placeholder="350.00"
          />
        </div>
      </div>
      <p className="faint" style={{ fontSize: 11.5, marginTop: -8, marginBottom: 14 }}>
        Leave a price blank if that format isn&rsquo;t offered. Live stream normally runs $100 under
        the classroom seat — CRT is the exception.
      </p>

      <div className="field">
        <label className="label" htmlFor="location">
          Location
        </label>
        <input
          className="input"
          id="location"
          name="location"
          defaultValue={editing?.location ?? 'Masters Touch Training Center — Cleveland, OH'}
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="seatsTotal">
          Seats
        </label>
        <input
          className="input"
          id="seatsTotal"
          name="seatsTotal"
          type="number"
          min={0}
          max={500}
          defaultValue={editing?.seatsTotal ?? 12}
          required
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="note">
          Note
        </label>
        <textarea
          className="input"
          id="note"
          name="note"
          rows={3}
          defaultValue={editing?.note ?? ''}
          placeholder="Three-day certification course, 18 hours…"
        />
      </div>

      <label className="checkbox">
        <input type="checkbox" name="published" defaultChecked={editing?.published ?? false} />
        <span>Published — visible to members</span>
      </label>

      <button className="btn btn--dark btn--block" type="submit" disabled={pending} style={{ marginTop: 14 }}>
        {pending ? 'Saving…' : editing ? 'Save changes' : 'Add class'}
      </button>

      {editing ? (
        <a className="btn btn--outline btn--block" href="/admin/classes" style={{ marginTop: 8 }}>
          Cancel
        </a>
      ) : null}
    </form>
  );
}
