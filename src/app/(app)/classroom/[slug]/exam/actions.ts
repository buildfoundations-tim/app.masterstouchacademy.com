'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { assertCourseAccess } from '@/lib/courses';

const SubmitInput = z.object({
  quizId: z.string().min(1),
  courseSlug: z.string().min(1),
  answers: z.record(z.string(), z.number().int().min(0)),
});

export type ExamState = { error: string | null };

/**
 * Score a final-exam attempt.
 *
 * Everything that decides the outcome is read fresh from the database inside
 * this action: the answer key, the pass mark, and the entitlement. The client
 * supplies only which option index it chose per question.
 */
export async function submitExam(_prev: ExamState, formData: FormData): Promise<ExamState> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const quizId = String(formData.get('quizId') ?? '');
  const courseSlug = String(formData.get('courseSlug') ?? '');

  // Answers arrive as q:<questionId> fields.
  const answers: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('q:')) continue;
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0) answers[key.slice(2)] = n;
  }

  const parsed = SubmitInput.safeParse({ quizId, courseSlug, answers });
  if (!parsed.success) return { error: 'That submission was not valid. Please try again.' };

  const quiz = await db.quiz.findUnique({
    where: { id: parsed.data.quizId },
    select: {
      id: true,
      questions: { select: { id: true, correct: true } },
      finalForCourse: {
        select: { id: true, slug: true, group: true, published: true, passingScore: true, ceHours: true },
      },
    },
  });

  const course = quiz?.finalForCourse;
  if (!quiz || !course || course.slug !== parsed.data.courseSlug) {
    return { error: 'That exam could not be found.' };
  }

  await assertCourseAccess(course.id, user);

  // The UI states the exam opens only once every lesson is done; enforce it
  // here too, or the rule is decorative and a direct POST walks past it.
  const [lessonTotal, lessonDone] = await Promise.all([
    db.lesson.count({ where: { module: { courseId: course.id } } }),
    db.lessonProgress.count({
      where: { userId: user.id, completed: true, lesson: { module: { courseId: course.id } } },
    }),
  ]);
  if (lessonTotal === 0 || lessonDone < lessonTotal) {
    return { error: 'Finish every lesson before taking the final exam.' };
  }

  if (Object.keys(parsed.data.answers).length < quiz.questions.length) {
    return { error: 'Answer every question before submitting.' };
  }

  const correctCount = quiz.questions.reduce(
    (acc, q) => acc + (parsed.data.answers[q.id] === q.correct ? 1 : 0),
    0
  );
  const score = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = score >= course.passingScore;

  const priorAttempts = await db.quizAttempt.count({ where: { userId: user.id, quizId: quiz.id } });

  await db.quizAttempt.create({
    data: {
      quizId: quiz.id,
      userId: user.id,
      answers: parsed.data.answers,
      score,
      passed,
      attemptNumber: priorAttempts + 1,
    },
  });

  if (passed) {
    // upsert, not create: a member who passes twice keeps one certificate
    // rather than colliding on the unique [userId, courseId].
    await db.certificate.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      create: { userId: user.id, courseId: course.id, ceHours: course.ceHours, score },
      update: { score },
    });
  }

  revalidatePath(`/classroom/${course.slug}`);
  revalidatePath('/certificates');
  redirect(`/classroom/${course.slug}/exam/result?score=${score}`);
}
