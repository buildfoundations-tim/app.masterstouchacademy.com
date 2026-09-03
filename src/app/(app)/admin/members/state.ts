/**
 * Shape of the feedback the member actions hand back to their forms.
 *
 * Lives here rather than in actions.ts because a `'use server'` module may only
 * export async functions — a constant in there fails the build with
 * "A 'use server' file can only export async functions, found object."
 */
export type MemberActionState = { error: string | null; note: string | null };

export const EMPTY: MemberActionState = { error: null, note: null };
