import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertCourseAccess } from '@/lib/courses';
import { submitExam } from './actions';
import { ExamForm } from './form';

export const metadata = { title: 'Final exam' };

export default async function ExamPage({ params }: PageProps<'/classroom/[slug]/exam'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { slug } = await params;

  const course = await db.course.findUnique({
    where: { slug },
    select: {
      id: true, slug: true, title: true, group: true, published: true,
      passingScore: true, ceHours: true,
      finalExam: {
        select: {
          id: true,
          title: true,
          // `correct` is deliberately NOT selected. The answer key must never
          // reach the browser while an attempt is open — scoring happens on
          // the server against a fresh read.
          questions: {
            orderBy: { position: 'asc' },
            select: { id: true, prompt: true, options: true, position: true },
          },
        },
      },
    },
  });

  if (!course?.finalExam) notFound();
  await assertCourseAccess(course.id, user);

  const [lessonTotal, lessonDone, attempts, certificate] = await Promise.all([
    db.lesson.count({ where: { module: { courseId: course.id } } }),
    db.lessonProgress.count({
      where: { userId: user.id, completed: true, lesson: { module: { courseId: course.id } } },
    }),
    db.quizAttempt.findMany({
      where: { userId: user.id, quizId: course.finalExam.id },
      orderBy: { attemptNumber: 'desc' },
      select: { score: true, passed: true, attemptNumber: true, submittedAt: true },
    }),
    db.certificate.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      select: { shareId: true },
    }),
  ]);

  const lessonsComplete = lessonTotal > 0 && lessonDone === lessonTotal;
  const passed = attempts.find((a) => a.passed) ?? null;

  return (
    <>
      <header className="topbar">
        <Link href={`/classroom/${slug}`} className="faint" style={{ fontSize: 13 }}>
          ← {course.title}
        </Link>
        <h1 className="topbar__title" style={{ fontSize: 19 }}>
          Final exam
        </h1>
      </header>

      <div className="page" style={{ maxWidth: 780 }}>
        {passed ? (
          <div className="card" style={{ padding: 26, textAlign: 'center' }}>
            <span className="badge badge--done" style={{ fontSize: 12 }}>
              Passed · {passed.score}%
            </span>
            <h2 className="display" style={{ fontSize: 28, margin: '14px 0 8px' }}>
              You&rsquo;ve already passed this exam
            </h2>
            <p className="muted" style={{ marginBottom: 20 }}>
              {course.ceHours} CE hours were recorded on your certificate.
            </p>
            {certificate ? (
              <Link className="btn btn--dark" href={`/certificates/${certificate.shareId}`}>
                View certificate
              </Link>
            ) : null}
          </div>
        ) : !lessonsComplete ? (
          <div className="card" style={{ padding: 26 }}>
            <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
              Finish the lessons first
            </h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              You&rsquo;ve completed {lessonDone} of {lessonTotal} lessons. The final exam opens once
              you&rsquo;ve worked through all of them.
            </p>
            <Link className="btn btn--dark" href={`/classroom/${slug}`}>
              Back to the course
            </Link>
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 6 }}>
              {course.finalExam.questions.length} questions · {course.passingScore}% to pass
              {attempts.length > 0 ? ` · attempt ${attempts.length + 1}` : ''}
            </p>
            {attempts.length > 0 ? (
              <p className="alert alert--error" style={{ marginTop: 12 }}>
                Last attempt scored {attempts[0].score}%. You need {course.passingScore}% to pass.
              </p>
            ) : null}

            <ExamForm
              action={submitExam}
              courseSlug={slug}
              quizId={course.finalExam.id}
              questions={course.finalExam.questions}
            />
          </>
        )}
      </div>
    </>
  );
}
