'use client';

import { useActionState } from 'react';

import type { ExamState } from './actions';

type Question = { id: string; prompt: string; options: string[]; position: number };

export function ExamForm({
  action,
  courseSlug,
  quizId,
  questions,
}: {
  action: (prev: ExamState, formData: FormData) => Promise<ExamState>;
  courseSlug: string;
  quizId: string;
  questions: Question[];
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}

      <input type="hidden" name="quizId" value={quizId} />
      <input type="hidden" name="courseSlug" value={courseSlug} />

      {questions.map((q, i) => (
        <fieldset key={q.id} className="card question">
          <legend>
            <span className="question__num">{String(i + 1).padStart(2, '0')}</span>
            {q.prompt}
          </legend>
          {q.options.map((option, oi) => (
            <label key={oi} className="option">
              <input type="radio" name={`q:${q.id}`} value={oi} required />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <button className="btn btn--dark" type="submit" disabled={pending} style={{ marginTop: 18 }}>
        {pending ? 'Scoring…' : 'Submit exam'}
      </button>
    </form>
  );
}
