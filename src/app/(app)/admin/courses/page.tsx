import Link from 'next/link';

import { listCoursesForBuilder } from '@/lib/course-builder';
import { money } from '@/lib/format';

export const metadata = { title: 'Admin · Courses' };

export default async function AdminCoursesPage() {
  const courses = await listCoursesForBuilder();

  const iicrc = courses.filter((c) => c.group === 'iicrc');
  const cec = courses.filter((c) => c.group === 'cec');

  const section = (title: string, note: string, rows: typeof courses) =>
    rows.length === 0 ? null : (
      <section style={{ marginBottom: 26 }}>
        <div className="section-head">
          <h2>{title}</h2>
          <span className="faint" style={{ fontSize: 12.5 }}>
            {note}
          </span>
        </div>
        <div className="card table-wrap">
          <div className="ctable">
            <div className="ctable__head">
              <span>Course</span>
              <span>Outline</span>
              <span>Price</span>
              <span>Hours</span>
              <span>Status</span>
            </div>
            {rows.map((c) => (
              <Link key={c.id} href={`/admin/courses/${c.id}`} className="ctable__row">
                <span className="mtable__name">
                  <span>
                    <strong>{c.code}</strong> — {c.title}
                  </span>
                  <span className="faint mtable__email">/{c.slug}</span>
                </span>
                <span className="muted">
                  {c.moduleCount} module{c.moduleCount === 1 ? '' : 's'} · {c.lessonCount} lesson
                  {c.lessonCount === 1 ? '' : 's'}
                </span>
                <span className="muted">{money(c.priceCents)}</span>
                <span className="muted">
                  {c.hours} hrs{c.ceHours ? ` · ${c.ceHours} CE` : ''}
                </span>
                <span>
                  <span className={`badge${c.published ? ' badge--done' : ' badge--locked'}`}>
                    {c.published ? 'Live' : 'Draft'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Courses</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {courses.filter((c) => c.published).length} of {courses.length} live
        </span>
      </header>

      <div className="page">
        <div className="section-head" style={{ marginTop: 0 }}>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 620 }}>
            Everything the classroom renders is edited here — a course&rsquo;s copy and price, its
            modules, and each lesson. A course stays a draft until it has at least one lesson.
          </p>
          <Link className="btn btn--dark btn--sm" href="/admin/courses/new">
            New course
          </Link>
        </div>

        {section('IICRC certification', 'Sold separately at every tier', iicrc)}
        {section('Continuing education', 'Included with Pro and above', cec)}

        {courses.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: 'center' }}>
            <p className="muted">No courses yet.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
