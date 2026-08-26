import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { assertCourseAccess, formatDuration } from '@/lib/courses';
import { completeLesson } from './actions';
import { LessonBody } from './lesson-body';

export const metadata = { title: 'Lesson' };

export default async function LessonPage({ params }: PageProps<'/classroom/[slug]/[lessonId]'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { slug, lessonId } = await params;

  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: {
        include: {
          course: { select: { id: true, slug: true, title: true, group: true, published: true } },
        },
      },
    },
  });

  // Guard against a lesson id from a different course being pasted into the URL.
  if (!lesson || lesson.module.course.slug !== slug) notFound();

  // The access check is the gate — a locked course 404s rather than rendering.
  await assertCourseAccess(lesson.module.course.id, user);

  const [progress, siblings] = await Promise.all([
    db.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: lesson.id } },
      select: { seconds: true, percent: true, completed: true },
    }),
    db.lesson.findMany({
      where: { module: { courseId: lesson.module.course.id } },
      orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
      select: { id: true, title: true, module: { select: { position: true } }, position: true },
    }),
  ]);

  const index = siblings.findIndex((l) => l.id === lesson.id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index < siblings.length - 1 ? siblings[index + 1] : null;

  return (
    <>
      <header className="topbar">
        <Link href={`/classroom/${slug}`} className="faint" style={{ fontSize: 13 }}>
          ← {lesson.module.course.title}
        </Link>
        <h1 className="topbar__title" style={{ fontSize: 18 }}>
          {lesson.title}
        </h1>
        <span className="faint" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
          Lesson {index + 1} of {siblings.length}
        </span>
      </header>

      <div className="page">
        <p className="eyebrow" style={{ marginBottom: 10 }}>
          {lesson.module.title}
        </p>

        <LessonBody
          type={lesson.type}
          title={lesson.title}
          body={lesson.body}
          assetKey={lesson.assetKey}
          resourceUrl={lesson.resourceUrl}
          duration={formatDuration(lesson.durationSeconds)}
        />

        <div className="lesson-nav">
          <div>
            {prev ? (
              <Link className="btn btn--outline btn--sm" href={`/classroom/${slug}/${prev.id}`}>
                ← Previous
              </Link>
            ) : null}
          </div>

          <form action={completeLesson} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="courseSlug" value={slug} />
            {next ? <input type="hidden" name="nextLessonId" value={next.id} /> : null}

            {progress?.completed ? (
              <span className="badge badge--done">Completed</span>
            ) : (
              <button className="btn btn--dark" type="submit">
                {next ? 'Mark complete and continue' : 'Mark complete'}
              </button>
            )}

            {progress?.completed && next ? (
              <Link className="btn btn--outline btn--sm" href={`/classroom/${slug}/${next.id}`}>
                Next →
              </Link>
            ) : null}
          </form>
        </div>
      </div>
    </>
  );
}
