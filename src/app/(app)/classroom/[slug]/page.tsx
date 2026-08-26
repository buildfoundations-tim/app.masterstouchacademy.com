import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { loadCourseForUser, formatDuration } from '@/lib/courses';
import { TIER_LABEL } from '@/lib/access';
import { db } from '@/lib/db';

export async function generateMetadata({ params }: PageProps<'/classroom/[slug]'>) {
  const { slug } = await params;
  const course = await db.course.findUnique({ where: { slug }, select: { title: true } });
  return { title: course?.title ?? 'Course' };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default async function CoursePage({ params }: PageProps<'/classroom/[slug]'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { slug } = await params;
  const { course, unlocked, lock, progressByLesson, lessons, completedCount, percent, bestAttempt } =
    await loadCourseForUser(slug, user);

  // First lesson not yet completed — what "Resume" should open.
  const nextLesson = lessons.find((l) => !progressByLesson.get(l.id)?.completed) ?? lessons[0];

  return (
    <>
      <header className="topbar">
        <Link href="/classroom" className="faint" style={{ fontSize: 13 }}>
          ← Classroom
        </Link>
        <h1 className="topbar__title" style={{ fontSize: 19 }}>
          {course.title}
        </h1>
      </header>

      <div className="page">
        <div className="course-detail">
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span className={`badge${course.group === 'iicrc' ? ' badge--ink' : ''}`}>{course.code}</span>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {course.hours} hours · {course.days} · {course.level}
              </span>
            </div>

            <h2 className="display" style={{ fontSize: 32, marginBottom: 12 }}>
              {course.title}
            </h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 24 }}>
              {course.description}
            </p>

            {unlocked ? (
              <>
                {lessons.length > 0 ? (
                  <div className="card" style={{ padding: '16px 18px', marginBottom: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                      <strong>
                        {completedCount} of {lessons.length} lessons complete
                      </strong>
                      <span className="faint">{percent}%</span>
                    </div>
                    <div className="bar">
                      <div className="bar__fill" style={{ width: `${percent}%` }} />
                    </div>
                    {nextLesson ? (
                      <Link
                        href={`/classroom/${course.slug}/${nextLesson.id}`}
                        className="btn btn--dark"
                        style={{ marginTop: 14, display: 'inline-block' }}
                      >
                        {completedCount === 0 ? 'Start course' : percent === 100 ? 'Review lessons' : 'Resume'}
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <p className="alert alert--info">
                    This course is unlocked for you, but its lessons haven&rsquo;t been published yet.
                  </p>
                )}

                <h3 className="display" style={{ fontSize: 20, margin: '28px 0 12px' }}>
                  Course outline
                </h3>

                {course.modules.map((module, mi) => (
                  <section key={module.id} className="module">
                    <div className="module__head">
                      <span className="module__num">{String(mi + 1).padStart(2, '0')}</span>
                      <h4>{module.title}</h4>
                    </div>
                    <ol className="module__lessons">
                      {module.lessons.map((lesson) => {
                        const p = progressByLesson.get(lesson.id);
                        return (
                          <li key={lesson.id}>
                            <Link href={`/classroom/${course.slug}/${lesson.id}`} className="lesson-row">
                              <span className={`lesson-row__tick${p?.completed ? ' is-done' : ''}`} aria-hidden="true">
                                {p?.completed ? '✓' : ''}
                              </span>
                              <span className="lesson-row__title">{lesson.title}</span>
                              <span className="lesson-row__meta">
                                {lesson.type === 'video' ? formatDuration(lesson.durationSeconds) : lesson.type}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                ))}

                {course.finalExam ? (
                  <div className="card" style={{ padding: '18px 20px', marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <h4 style={{ fontFamily: 'var(--ff-display)', fontWeight: 400, fontSize: 20 }}>
                          Final exam
                        </h4>
                        <p className="faint" style={{ fontSize: 13 }}>
                          {course.finalExam._count.questions} questions · {course.passingScore}% to pass
                          {bestAttempt ? ` · best score ${bestAttempt.score}%` : ''}
                        </p>
                      </div>
                      {bestAttempt?.passed ? (
                        <span className="badge badge--done">Passed</span>
                      ) : (
                        <Link
                          href={`/classroom/${course.slug}/exam`}
                          className="btn btn--outline btn--sm"
                          aria-disabled={percent < 100}
                        >
                          {percent < 100 ? 'Finish the lessons first' : 'Take the exam'}
                        </Link>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="card" style={{ padding: 24 }}>
                <h3 className="display" style={{ fontSize: 22, marginBottom: 10 }}>
                  {lock === 'upgrade-or-purchase'
                    ? 'Included with Pro membership'
                    : 'This certification course is purchased separately'}
                </h3>
                <p className="muted" style={{ marginBottom: 18, lineHeight: 1.7 }}>
                  {lock === 'upgrade-or-purchase' ? (
                    <>
                      You&rsquo;re on {TIER_LABEL[user.tier]}. Pro at $69 a month opens the whole
                      continuing education library, or you can buy this course outright for{' '}
                      {money(course.priceCents)}.
                    </>
                  ) : (
                    <>
                      IICRC certification courses are sold a la carte on every membership tier,
                      including yours. Paid tiers get a discount on the seat, not the course itself.
                    </>
                  )}
                </p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {/* No checkout exists yet — these route to the marketing site's
                      enquiry form rather than pretending to sell. */}
                  <a
                    className="btn btn--dark"
                    href={`https://masterstouchacademy.com/contact?topic=${
                      course.group === 'iicrc' ? 'Certification' : 'Membership'
                    }&course=${encodeURIComponent(course.title)}`}
                  >
                    {lock === 'upgrade-or-purchase' ? 'Ask about Pro' : 'Ask about a seat'}
                  </a>
                  <a className="btn btn--outline" href="https://masterstouchacademy.com/membership">
                    Compare plans
                  </a>
                </div>
              </div>
            )}
          </div>

          <aside>
            <div className="card" style={{ padding: 20 }}>
              <h3 className="eyebrow" style={{ marginBottom: 12 }}>
                At a glance
              </h3>
              <dl className="facts">
                <div>
                  <dt>Format</dt>
                  <dd>{course.group === 'iicrc' ? 'Classroom or live stream' : 'On demand'}</dd>
                </div>
                <div>
                  <dt>Length</dt>
                  <dd>
                    {course.hours} hours · {course.days}
                  </dd>
                </div>
                <div>
                  <dt>CE hours</dt>
                  <dd>{course.ceHours}</dd>
                </div>
                <div>
                  <dt>Price</dt>
                  <dd>{money(course.priceCents)}</dd>
                </div>
                {course.priceLiveCents ? (
                  <div>
                    <dt>Live stream</dt>
                    <dd>{money(course.priceLiveCents)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Pass mark</dt>
                  <dd>{course.passingScore}%</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
