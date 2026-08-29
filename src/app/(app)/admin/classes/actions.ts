'use server';

import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { requireOwner } from '@/lib/admin';
import { parseClassInput } from '@/lib/class-input';

export type ClassFormState = { error: string | null; ok?: string };

export async function saveClass(_prev: ClassFormState, formData: FormData): Promise<ClassFormState> {
  await requireOwner();

  const parsed = parseClassInput({
    id: (formData.get('id') as string) || undefined,
    courseId: formData.get('courseId'),
    title: formData.get('title'),
    mode: formData.get('mode'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    dateLabel: formData.get('dateLabel'),
    location: formData.get('location'),
    note: formData.get('note') ?? undefined,
    seatsTotal: formData.get('seatsTotal'),
    published: formData.get('published') === 'on',
    inPersonPrice: formData.get('inPersonPrice'),
    virtualPrice: formData.get('virtualPrice'),
  });

  if (!parsed.ok) return { error: parsed.error };

  const { id, ...data } = parsed.value;

  // The course must exist and be a certification course — the schedule is for
  // IICRC classes, not the self-paced CEC library.
  const course = await db.course.findUnique({
    where: { id: data.courseId },
    select: { group: true },
  });
  if (!course) return { error: 'That course no longer exists.' };
  if (course.group !== 'iicrc') {
    return { error: 'Only IICRC certification courses are scheduled as classes.' };
  }

  if (id) {
    await db.scheduledClass.update({ where: { id }, data });
  } else {
    await db.scheduledClass.create({ data });
  }

  revalidatePath('/admin/classes');
  revalidatePath('/schedule');
  return { error: null, ok: id ? 'Class updated.' : 'Class added.' };
}

export async function togglePublished(formData: FormData): Promise<void> {
  await requireOwner();

  const id = String(formData.get('id') ?? '');
  const current = await db.scheduledClass.findUnique({ where: { id }, select: { published: true } });
  if (!current) return;

  await db.scheduledClass.update({ where: { id }, data: { published: !current.published } });
  revalidatePath('/admin/classes');
  revalidatePath('/schedule');
}

export async function deleteClass(formData: FormData): Promise<void> {
  await requireOwner();

  const id = String(formData.get('id') ?? '');

  // Refuse to delete a class someone has booked — that would silently drop a
  // paid seat. Unpublishing hides it from members without destroying the record.
  const booked = await db.seatBooking.count({ where: { classId: id } });
  if (booked > 0) return;

  await db.scheduledClass.delete({ where: { id } }).catch(() => {});
  revalidatePath('/admin/classes');
  revalidatePath('/schedule');
}
