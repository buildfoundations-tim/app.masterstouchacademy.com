'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/admin';
import { setTierOverride, grantCourse, revokeGrant } from '@/lib/members';
import type { MemberActionState } from './state';

/**
 * Admin → Members actions.
 *
 * Every one calls requireOwner() first. The /admin layout gates the pages, but
 * a server action is a public endpoint reachable without the layout ever
 * running — the gate has to be here too.
 */

export async function adjustTier(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  await requireOwner();

  const userId = String(formData.get('userId') ?? '');
  const raw = String(formData.get('tier') ?? '');
  const reason = String(formData.get('reason') ?? '');

  if (!userId) return { error: 'Missing member.', note: null };

  // An empty select value means "clear", which is a different thing from tier 1
  // and has to survive the round trip as null rather than 0.
  const tier = raw === '' ? null : Number(raw);

  const result = await setTierOverride({ userId, tier, reason });
  if (!result.ok) return { error: result.reason, note: null };

  revalidatePath(`/admin/members/${userId}`);
  revalidatePath('/admin/members');

  return {
    error: null,
    note:
      tier === null
        ? 'Override cleared — their tier now follows what they pay for.'
        : `Tier set to ${result.tier} by hand.`,
  };
}

export async function grant(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  await requireOwner();

  const userId = String(formData.get('userId') ?? '');
  const courseId = String(formData.get('courseId') ?? '');
  if (!userId || !courseId) return { error: 'Pick a course to grant.', note: null };

  const result = await grantCourse({ userId, courseId });
  if (!result.ok) return { error: result.reason, note: null };

  revalidatePath(`/admin/members/${userId}`);
  return {
    error: null,
    note: result.already ? 'They already had that grant.' : 'Course granted.',
  };
}

export async function revoke(formData: FormData): Promise<void> {
  await requireOwner();

  const userId = String(formData.get('userId') ?? '');
  const courseId = String(formData.get('courseId') ?? '');
  if (!userId || !courseId) return;

  await revokeGrant({ userId, courseId });
  revalidatePath(`/admin/members/${userId}`);
}
