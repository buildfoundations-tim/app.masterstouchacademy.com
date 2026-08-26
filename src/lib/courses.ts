import 'server-only';

import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { canAccessCourse, lockReason, type LockReason } from '@/lib/access';

/**
 * Load a course with its full outline plus the viewer's access decision and
 * progress. Everything the classroom pages need in one place, so the access
 * check cannot be forgotten by a new page.
 */
export async function loadCourseForUser(slug: string, user: { id: string; tier: number }) {
  const course = await db.course.findUnique({
    where: { slug },
    include: {
      modules: {
        orderBy: { position: 'asc' },
        include: {
          lessons: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              title: true,
              type: true,
              position: true,
              durationSeconds: true,
              assetKey: true,
            },
          },
        },
      },
      finalExam: { select: { id: true, title: true, _count: { select: { questions: true } } } },
    },
  });

  if (!course || !course.published) notFound();

  const [entitlements, progress, enrollment, examAttempts] = await Promise.all([
    db.entitlement.findMany({
      where: { userId: user.id },
      select: { courseId: true, expiresAt: true },
    }),
    db.lessonProgress.findMany({
      where: { userId: user.id, lesson: { module: { courseId: course.id } } },
      select: { lessonId: true, seconds: true, percent: true, completed: true },
    }),
    db.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { percent: true, startedAt: true, completedAt: true },
    }),
    course.finalExam
      ? db.quizAttempt.findMany({
          where: { userId: user.id, quizId: course.finalExam.id },
          orderBy: { attemptNumber: 'desc' },
          select: { score: true, passed: true, attemptNumber: true, submittedAt: true },
        })
      : Promise.resolve([]),
  ]);

  const unlocked = canAccessCourse({ tier: user.tier, course, entitlements });
  const lock: LockReason = lockReason({ tier: user.tier, course, entitlements });

  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));

  const lessons = course.modules.flatMap((m) => m.lessons);
  const completedCount = lessons.filter((l) => progressByLesson.get(l.id)?.completed).length;
  const percent = lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0;

  return {
    course,
    unlocked,
    lock,
    progressByLesson,
    lessons,
    completedCount,
    percent,
    enrollment,
    bestAttempt: examAttempts.find((a) => a.passed) ?? examAttempts[0] ?? null,
    attemptCount: examAttempts.length,
  };
}

/**
 * Assert the viewer may open this course, or 404.
 *
 * Deliberately 404 rather than 403: a locked course's *existence* is public on
 * the marketing site, but its lesson content should not confirm anything to a
 * probing request. Callers that want to render a paywall use loadCourseForUser
 * and branch on `unlocked` instead.
 */
export async function assertCourseAccess(courseId: string, user: { id: string; tier: number }) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, group: true, published: true },
  });
  if (!course || !course.published) notFound();

  const entitlements = await db.entitlement.findMany({
    where: { userId: user.id },
    select: { courseId: true, expiresAt: true },
  });

  if (!canAccessCourse({ tier: user.tier, course, entitlements })) notFound();
  return course;
}

/** Recompute and store the denormalised course percentage for list views. */
export async function recalcEnrollment(userId: string, courseId: string): Promise<number> {
  const [total, done] = await Promise.all([
    db.lesson.count({ where: { module: { courseId } } }),
    db.lessonProgress.count({
      where: { userId, completed: true, lesson: { module: { courseId } } },
    }),
  ]);

  const percent = total ? Math.round((done / total) * 100) : 0;

  await db.enrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { userId, courseId, percent },
    update: { percent, ...(percent === 100 ? { completedAt: new Date() } : {}) },
  });

  return percent;
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
