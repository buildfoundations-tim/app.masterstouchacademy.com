import Link from 'next/link';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { canAccessCourse, lockReason, TIER_LABEL, TIER } from '@/lib/access';

export const metadata = { title: 'Classroom' };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default async function ClassroomPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const [courses, entitlements, enrollments] = await Promise.all([
    db.course.findMany({
      where: { published: true },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true, slug: true, code: true, group: true, title: true, blurb: true,
        priceCents: true, hours: true, days: true,
        _count: { select: { modules: true } },
      },
    }),
    db.entitlement.findMany({
      where: { userId: user.id },
      select: { courseId: true, expiresAt: true },
    }),
    db.enrollment.findMany({
      where: { userId: user.id },
      select: { courseId: true, percent: true },
    }),
  ]);

  const progressByCourse = new Map(enrollments.map((e) => [e.courseId, e.percent]));

  const decorated = courses.map((course) => ({
    ...course,
    unlocked: canAccessCourse({ tier: user.tier, course, entitlements }),
    lock: lockReason({ tier: user.tier, course, entitlements }),
    percent: progressByCourse.get(course.id) ?? 0,
  }));

  const cec = decorated.filter((c) => c.group === 'cec');
  const iicrc = decorated.filter((c) => c.group === 'iicrc');
  const unlockedCount = decorated.filter((c) => c.unlocked).length;

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Classroom</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {unlockedCount} of {decorated.length} courses open to you
        </span>
      </header>

      <div className="page">
        {user.tier < TIER.PRO ? (
          <p className="alert alert--info">
            You&rsquo;re on <strong>{TIER_LABEL[user.tier]}</strong>. Pro membership opens the whole
            continuing education library — {cec.length} courses — for $69 a month.{' '}
            <Link href="/membership" style={{ fontWeight: 600, color: 'var(--gold-deep)' }}>
              Compare plans
            </Link>
          </p>
        ) : null}

        <section>
          <div className="section-head" style={{ marginTop: 8 }}>
            <h2>Continuing education</h2>
            <span className="faint" style={{ fontSize: 12.5 }}>
              Included with Pro and above
            </span>
          </div>
          <div className="grid grid--3">
            {cec.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>IICRC certification</h2>
            <span className="faint" style={{ fontSize: 12.5 }}>
              Purchased separately at every tier
            </span>
          </div>
          <div className="grid grid--3">
            {iicrc.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

type CardCourse = {
  slug: string;
  code: string;
  title: string;
  blurb: string;
  priceCents: number;
  hours: number;
  days: string;
  unlocked: boolean;
  lock: 'purchase-required' | 'upgrade-or-purchase' | null;
  percent: number;
  _count: { modules: number };
};

function CourseCard({ course }: { course: CardCourse }) {
  const body = (
    <>
      <div className="course__media">{course.code}</div>
      <div className="course__body">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {course.unlocked ? (
            course.percent > 0 ? (
              <span className="badge badge--done">{course.percent}% done</span>
            ) : (
              <span className="badge">Open</span>
            )
          ) : (
            <span className="badge badge--locked">
              {course.lock === 'upgrade-or-purchase' ? 'Pro' : money(course.priceCents)}
            </span>
          )}
          <span className="faint" style={{ fontSize: 12 }}>
            {course.hours} hrs · {course.days}
          </span>
        </div>

        <h3 className="course__title">{course.title}</h3>
        <p className="course__blurb">{course.blurb}</p>

        {course.unlocked && course.percent > 0 ? (
          <div className="bar" aria-hidden="true">
            <div className="bar__fill" style={{ width: `${course.percent}%` }} />
          </div>
        ) : null}

        <div className="course__foot">
          <span className="faint" style={{ fontSize: 12 }}>
            {course._count.modules > 0 ? `${course._count.modules} modules` : 'Coming soon'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-deep)' }}>
            {course.unlocked ? (course.percent > 0 ? 'Resume →' : 'Start →') : 'Details →'}
          </span>
        </div>
      </div>
    </>
  );

  return (
    <Link
      href={`/classroom/${course.slug}`}
      className={`course${course.unlocked ? '' : ' course--locked'}`}
    >
      {body}
    </Link>
  );
}
