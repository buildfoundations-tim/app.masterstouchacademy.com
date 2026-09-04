'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/admin';
import { markAttendance, markAllPresent, clearAttendance } from '@/lib/attendance';
import type { AttendanceStatus } from '@/generated/prisma/enums';

/**
 * Roll-call actions.
 *
 * Plain form actions rather than useActionState: a roll call is a stream of
 * single clicks during a class, and the honest feedback is the row changing,
 * not a message. requireOwner() first in every one — a server action is a
 * public endpoint the /admin layout never runs for.
 */

const VALID: AttendanceStatus[] = ['present', 'late', 'absent'];

function isStatus(value: string): value is AttendanceStatus {
  return (VALID as string[]).includes(value);
}

export async function mark(formData: FormData): Promise<void> {
  await requireOwner();

  const classId = String(formData.get('classId') ?? '');
  const userId = String(formData.get('userId') ?? '');
  const raw = String(formData.get('status') ?? '');
  if (!classId || !userId) return;

  // "clear" is its own verb rather than a fourth status: unmarked has to stay
  // distinguishable from absent, because only one of them is a decision.
  if (raw === 'clear') {
    await clearAttendance({ classId, userId });
  } else if (isStatus(raw)) {
    await markAttendance({ classId, userId, status: raw });
  }

  revalidatePath('/admin/attendance');
}

export async function markEveryonePresent(formData: FormData): Promise<void> {
  await requireOwner();

  const classId = String(formData.get('classId') ?? '');
  if (!classId) return;

  await markAllPresent(classId);
  revalidatePath('/admin/attendance');
}
