/**
 * Feedback shape shared by the builder's forms.
 *
 * Separate from actions.ts because a `'use server'` module may only export
 * async functions — a constant there fails the build.
 */
export type BuilderState = { error: string | null; note: string | null };

export const EMPTY: BuilderState = { error: null, note: null };
