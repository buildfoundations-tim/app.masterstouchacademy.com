'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { assertCourseAccess, recalcEnrollment } from '@/lib/courses';

const CompleteInput = z.object({
  lessonId: z.string().min(1),
  courseSlug: z.string().min(1),
  nextLessonId: z.string().optional(),
});

/**
 * Mark a lesson complete and advance.
 *
 * Re-checks the session and the course entitlement here rather than trusting
 * that the page rendered — a server action is a public endpoint, reachable
 * without ever loading the page that shows the button.
 */
export async function completeLesson(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const parsed = CompleteInput.safeParse({
    lessonId: formData.get('lessonId'),
    courseSlug: formData.get('courseSlug'),
    nextLessonId: formData.get('nextLessonId') ?? undefined,
  });
  if (!parsed.success) return;

  const lesson = await db.lesson.findUnique({
    where: { id: parsed.data.lessonId },
    select: { id: true, durationSeconds: true, module: { select: { courseId: true } } },
  });
  if (!lesson) return;

  await assertCourseAccess(lesson.module.courseId, user);

  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
    create: {
      userId: user.id,
      lessonId: lesson.id,
      seconds: lesson.durationSeconds ?? 0,
      percent: 100,
      completed: true,
      completedAt: new Date(),
    },
    update: { percent: 100, completed: true, completedAt: new Date() },
  });

  await recalcEnrollment(user.id, lesson.module.courseId);

  revalidatePath(`/classroom/${parsed.data.courseSlug}`);
  revalidatePath('/classroom');

  if (parsed.data.nextLessonId) {
    redirect(`/classroom/${parsed.data.courseSlug}/${parsed.data.nextLessonId}`);
  }
  redirect(`/classroom/${parsed.data.courseSlug}`);
}

const ProgressInput = z.object({
  lessonId: z.string().min(1),
  seconds: z.number().int().min(0),
  percent: z.number().int().min(0).max(100),
});

/**
 * Throttled progress ping from the player (see vimeo-integration.md: the
 * timeupdate handler posts { assetKey, seconds, percent }).
 *
 * Deliberately never *un*-completes a lesson — a re-watch that starts at 0%
 * must not wipe a completion the member has already earned.
 */
export async function recordProgress(input: {
  lessonId: string;
  seconds: number;
  percent: number;
}): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user) return { ok: false };

  const parsed = ProgressInput.safeParse(input);
  if (!parsed.success) return { ok: false };

  const lesson = await db.lesson.findUnique({
    where: { id: parsed.data.lessonId },
    select: { id: true, module: { select: { courseId: true } } },
  });
  if (!lesson) return { ok: false };

  await assertCourseAccess(lesson.module.courseId, user);

  const existing = await db.lessonProgress.findUnique({
    where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
    select: { percent: true, completed: true },
  });

  // 95% counts as watched — players rarely fire a clean 100% at the end.
  const reachedEnd = parsed.data.percent >= 95;
  const completed = existing?.completed || reachedEnd;

  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
    create: {
      userId: user.id,
      lessonId: lesson.id,
      seconds: parsed.data.seconds,
      percent: parsed.data.percent,
      completed,
      completedAt: completed ? new Date() : null,
    },
    update: {
      seconds: parsed.data.seconds,
      percent: Math.max(existing?.percent ?? 0, parsed.data.percent),
      completed,
      ...(completed && !existing?.completed ? { completedAt: new Date() } : {}),
    },
  });

  if (completed && !existing?.completed) {
    await recalcEnrollment(user.id, lesson.module.courseId);
  }

  return { ok: true };
}
