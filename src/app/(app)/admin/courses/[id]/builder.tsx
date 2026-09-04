'use client';

import { useActionState, useState } from 'react';

import { saveCourseMeta, createModule, upsertLesson } from '../actions';
import { EMPTY, type BuilderState } from '../state';

type Action = (prev: BuilderState, formData: FormData) => Promise<BuilderState>;

export type CourseMetaValues = {
  id: string | null;
  slug: string;
  code: string;
  group: string;
  title: string;
  blurb: string;
  description: string;
  priceCents: number;
  priceLiveCents: number | null;
  hours: number;
  days: string;
  level: string;
  tag: string;
  ceHours: number;
  passingScore: number;
  published: boolean;
  sortOrder: number;
};

function dollars(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

function Feedback({ state }: { state: BuilderState }) {
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

/** Course copy, pricing and exam settings. */
export function CourseMetaForm({ course }: { course: CourseMetaValues }) {
  const [state, formAction, pending] = useActionState<BuilderState, FormData>(
    saveCourseMeta as Action,
    EMPTY
  );

  return (
    <div className="card admin-panel">
      <h2 className="admin-panel__title">{course.id ? 'Course details' : 'New course'}</h2>
      <Feedback state={state} />

      <form action={formAction}>
        <input type="hidden" name="courseId" value={course.id ?? ''} />
        {/* Publishing has its own action and its own guard; this form must not
            silently unpublish a live course just by being saved. */}
        <input type="hidden" name="published" value={String(course.published)} />

        <div className="field-row">
          <label className="field">
            <span className="label">Code</span>
            <input className="input" name="code" defaultValue={course.code} placeholder="WRT" required />
          </label>
          <label className="field">
            <span className="label">Slug</span>
            <input className="input" name="slug" defaultValue={course.slug} placeholder="water-damage" required />
            <span className="hint">Part of the URL members bookmark. Changing it breaks old links.</span>
          </label>
        </div>

        <label className="field">
          <span className="label">Title</span>
          <input className="input" name="title" defaultValue={course.title} required />
        </label>

        <label className="field">
          <span className="label">Blurb</span>
          <input className="input" name="blurb" defaultValue={course.blurb} />
          <span className="hint">One line, shown on the catalogue card.</span>
        </label>

        <label className="field">
          <span className="label">Description</span>
          <textarea className="input" name="description" rows={4} defaultValue={course.description} />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="label">Group</span>
            <select className="input" name="group" defaultValue={course.group}>
              <option value="iicrc">IICRC certification — sold separately</option>
              <option value="cec">Continuing education — included with Pro</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Sort order</span>
            <input className="input" name="sortOrder" type="number" defaultValue={course.sortOrder} />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Price</span>
            <input className="input" name="price" type="number" step="0.01" min="0" defaultValue={dollars(course.priceCents)} />
          </label>
          <label className="field">
            <span className="label">Live-stream price</span>
            <input className="input" name="priceLive" type="number" step="0.01" min="0" defaultValue={dollars(course.priceLiveCents)} />
            <span className="hint">Leave empty if there is no live-stream option.</span>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Hours</span>
            <input className="input" name="hours" type="number" min="0" defaultValue={course.hours} />
          </label>
          <label className="field">
            <span className="label">CE hours</span>
            <input className="input" name="ceHours" type="number" min="0" defaultValue={course.ceHours} />
            <span className="hint">What attendance awards for this course.</span>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Days</span>
            <input className="input" name="days" defaultValue={course.days} placeholder="3 days" />
          </label>
          <label className="field">
            <span className="label">Level</span>
            <input className="input" name="level" defaultValue={course.level} placeholder="Intro" />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="label">Tag</span>
            <input className="input" name="tag" defaultValue={course.tag} placeholder="IICRC" />
          </label>
          <label className="field">
            <span className="label">Passing score</span>
            <input className="input" name="passingScore" type="number" min="1" max="100" defaultValue={course.passingScore} />
            <span className="hint">Percent needed to pass the final exam.</span>
          </label>
        </div>

        <button className="btn btn--dark btn--sm" type="submit" disabled={pending}>
          {pending ? 'Saving…' : course.id ? 'Save course' : 'Create course'}
        </button>
      </form>
    </div>
  );
}

/** Add a module to the end of the outline. */
export function AddModuleForm({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState<BuilderState, FormData>(
    createModule as Action,
    EMPTY
  );

  return (
    <div className="card admin-panel">
      <h2 className="admin-panel__title">Add a module</h2>
      <Feedback state={state} />
      <form action={formAction} className="admin-form--row">
        <input type="hidden" name="courseId" value={courseId} />
        <input className="input" name="title" placeholder="Module title" required />
        <button className="btn btn--dark btn--sm" type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>
  );
}

export type LessonValues = {
  id: string;
  title: string;
  type: string;
  assetKey: string | null;
  durationSeconds: number | null;
  body: string | null;
  resourceUrl: string | null;
};

/**
 * Add or edit one lesson.
 *
 * The fields shown follow the chosen type, because a lesson only ever carries
 * one kind of content and showing all three at once invites filling in the
 * wrong one.
 */
export function LessonForm({
  courseId,
  moduleId,
  lesson,
  onDone,
}: {
  courseId: string;
  moduleId: string;
  lesson: LessonValues | null;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState<BuilderState, FormData>(
    upsertLesson as Action,
    EMPTY
  );
  const [type, setType] = useState(lesson?.type ?? 'text');

  return (
    <form action={formAction} className="lessonform">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="lessonId" value={lesson?.id ?? ''} />

      <Feedback state={state} />

      <div className="field-row">
        <label className="field">
          <span className="label">Title</span>
          <input className="input" name="title" defaultValue={lesson?.title ?? ''} required />
        </label>
        <label className="field">
          <span className="label">Type</span>
          <select
            className="input"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="text">Text</option>
            <option value="video">Video</option>
            <option value="resource">Resource</option>
            <option value="quiz">Quiz</option>
          </select>
        </label>
      </div>

      {type === 'video' ? (
        <div className="field-row">
          <label className="field">
            <span className="label">Asset key</span>
            <input className="input" name="assetKey" defaultValue={lesson?.assetKey ?? ''} placeholder="wrt-01" />
            <span className="hint">
              A stable key, not a Vimeo URL. The server resolves it to a video only after checking
              the member owns the course.
            </span>
          </label>
          <label className="field">
            <span className="label">Duration (seconds)</span>
            <input className="input" name="durationSeconds" type="number" min="0" defaultValue={lesson?.durationSeconds ?? ''} />
          </label>
        </div>
      ) : null}

      {type === 'text' ? (
        <label className="field">
          <span className="label">Body</span>
          <textarea className="input" name="body" rows={6} defaultValue={lesson?.body ?? ''} />
        </label>
      ) : null}

      {type === 'resource' ? (
        <label className="field">
          <span className="label">Link</span>
          <input className="input" name="resourceUrl" defaultValue={lesson?.resourceUrl ?? ''} placeholder="https://…" />
        </label>
      ) : null}

      {type === 'quiz' ? (
        <p className="hint" style={{ marginBottom: 12 }}>
          Quiz questions are not editable here yet — the lesson slot can be created, and the
          questions still have to be added to the database. See docs/roadmap.md.
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--dark btn--sm" type="submit" disabled={pending}>
          {pending ? 'Saving…' : lesson ? 'Save lesson' : 'Add lesson'}
        </button>
        {onDone ? (
          <button className="btn btn--outline btn--sm" type="button" onClick={onDone}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Collapsed by default so a long outline stays readable. */
export function LessonEditor({
  courseId,
  moduleId,
  lesson,
  label,
}: {
  courseId: string;
  moduleId: string;
  lesson: LessonValues | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="linkbtn" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div className="lessonform__wrap">
      <LessonForm
        courseId={courseId}
        moduleId={moduleId}
        lesson={lesson}
        onDone={() => setOpen(false)}
      />
    </div>
  );
}
