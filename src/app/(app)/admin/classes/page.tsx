import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { money, dateParts, formatDate } from '@/lib/format';
import { saveClass, togglePublished, deleteClass } from './actions';
import { ClassForm } from './form';

export const metadata = { title: 'Admin · Classes' };

export default async function AdminClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { edit } = await searchParams;

  const [classes, courses] = await Promise.all([
    db.scheduledClass.findMany({
      orderBy: { startDate: 'asc' },
      select: {
        id: true, title: true, dateLabel: true, startDate: true, endDate: true,
        location: true, note: true, mode: true, seatsTotal: true, published: true,
        inPersonPriceCents: true, virtualPriceCents: true, courseId: true,
        course: { select: { code: true, title: true } },
        _count: { select: { bookings: true } },
      },
    }),
    db.course.findMany({
      where: { group: 'iicrc' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, title: true },
    }),
  ]);

  const editing = edit ? classes.find((c) => c.id === edit) : undefined;

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Classes</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {classes.filter((c) => c.published).length} published · {classes.length} total
        </span>
      </header>

      <div className="page">
        <p className="alert alert--info">
          These are the dates members see on the schedule. The marketing site still keeps its own
          copy in <code>inc/data.php</code> — the two are kept in step by hand until this app
          exposes an API for it.
        </p>

        <div className="admin-split">
          <section>
            <h2 className="display" style={{ fontSize: 20, marginBottom: 12 }}>
              Scheduled classes
            </h2>

            {classes.length === 0 ? (
              <div className="card" style={{ padding: 24 }}>
                <p className="muted">No classes yet. Add the first one with the form.</p>
              </div>
            ) : (
              classes.map((k) => {
                const { month, day } = dateParts(k.startDate);
                const past = k.startDate < new Date();

                return (
                  <article key={k.id} className="admin-row card">
                    <div className="class-row__date">
                      <span className="class-row__month">{month}</span>
                      <span className="class-row__day">{day}</span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <span className="badge badge--ink">{k.course.code}</span>
                        {k.published ? (
                          <span className="badge badge--done">Published</span>
                        ) : (
                          <span className="badge badge--locked">Draft</span>
                        )}
                        {past ? <span className="badge badge--locked">Past</span> : null}
                      </div>

                      <h3 style={{ fontFamily: 'var(--ff-display)', fontSize: 18, lineHeight: 1.3 }}>
                        {k.title}
                      </h3>
                      <p className="faint" style={{ fontSize: 12.5 }}>
                        {formatDate(k.startDate)}
                        {k.endDate > k.startDate ? ` – ${formatDate(k.endDate)}` : ''} · {k.location}
                      </p>
                      <p className="faint" style={{ fontSize: 12.5 }}>
                        {k.inPersonPriceCents !== null ? `Classroom ${money(k.inPersonPriceCents)}` : ''}
                        {k.inPersonPriceCents !== null && k.virtualPriceCents !== null ? ' · ' : ''}
                        {k.virtualPriceCents !== null ? `Live stream ${money(k.virtualPriceCents)}` : ''}
                        {' · '}
                        {k._count.bookings} of {k.seatsTotal} booked
                      </p>
                    </div>

                    <div className="admin-row__actions">
                      <a className="btn btn--outline btn--sm" href={`/admin/classes?edit=${k.id}`}>
                        Edit
                      </a>
                      <form action={togglePublished}>
                        <input type="hidden" name="id" value={k.id} />
                        <button className="btn btn--outline btn--sm" type="submit">
                          {k.published ? 'Unpublish' : 'Publish'}
                        </button>
                      </form>
                      {k._count.bookings === 0 ? (
                        <form action={deleteClass}>
                          <input type="hidden" name="id" value={k.id} />
                          <button className="btn btn--outline btn--sm btn--danger" type="submit">
                            Delete
                          </button>
                        </form>
                      ) : (
                        <span className="faint" style={{ fontSize: 11.5, alignSelf: 'center' }}>
                          Has bookings
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <aside>
            <div className="card" style={{ padding: 20, position: 'sticky', top: 84 }}>
              <h2 className="display" style={{ fontSize: 19, marginBottom: 4 }}>
                {editing ? 'Edit class' : 'Add a class'}
              </h2>
              <p className="faint" style={{ fontSize: 12.5, marginBottom: 16 }}>
                {editing ? editing.title : 'Creates a new date on the schedule.'}
              </p>
              <ClassForm action={saveClass} courses={courses} editing={editing ?? null} />
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
