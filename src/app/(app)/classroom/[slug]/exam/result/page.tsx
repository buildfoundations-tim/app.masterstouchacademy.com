import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Exam result' };

export default async function ExamResultPage({ params }: PageProps<'/classroom/[slug]/exam/result'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { slug } = await params;

  const course = await db.course.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, passingScore: true, ceHours: true, finalExam: { select: { id: true } } },
  });
  if (!course?.finalExam) notFound();

  // Read the outcome from the stored attempt, not from the query string — the
  // score in the URL is display sugar and a member could edit it.
  const attempt = await db.quizAttempt.findFirst({
    where: { userId: user.id, quizId: course.finalExam.id },
    orderBy: { attemptNumber: 'desc' },
    select: { score: true, passed: true, attemptNumber: true },
  });
  if (!attempt) redirect(`/classroom/${slug}/exam`);

  const certificate = attempt.passed
    ? await db.certificate.findUnique({
        where: { userId_courseId: { userId: user.id, courseId: course.id } },
        select: { shareId: true },
      })
    : null;

  return (
    <>
      <header className="topbar">
        <Link href={`/classroom/${slug}`} className="faint" style={{ fontSize: 13 }}>
          ← {course.title}
        </Link>
        <h1 className="topbar__title" style={{ fontSize: 19 }}>
          Exam result
        </h1>
      </header>

      <div className="page" style={{ maxWidth: 620 }}>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div className={`score-ring${attempt.passed ? ' is-pass' : ''}`}>
            <span>{attempt.score}%</span>
          </div>

          <h2 className="display" style={{ fontSize: 30, margin: '18px 0 8px' }}>
            {attempt.passed ? 'Passed' : 'Not this time'}
          </h2>

          <p className="muted" style={{ marginBottom: 22, lineHeight: 1.7 }}>
            {attempt.passed ? (
              <>
                You scored {attempt.score}% against a {course.passingScore}% pass mark.{' '}
                {course.ceHours} CE hours have been recorded on your certificate.
              </>
            ) : (
              <>
                You scored {attempt.score}% and needed {course.passingScore}%. Attempt{' '}
                {attempt.attemptNumber} recorded — review the lessons and take it again when
                you&rsquo;re ready. There is no limit on attempts.
              </>
            )}
          </p>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {attempt.passed && certificate ? (
              <Link className="btn btn--dark" href={`/certificates/${certificate.shareId}`}>
                View certificate
              </Link>
            ) : (
              <Link className="btn btn--dark" href={`/classroom/${slug}/exam`}>
                Retake the exam
              </Link>
            )}
            <Link className="btn btn--outline" href={`/classroom/${slug}`}>
              Back to the course
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
