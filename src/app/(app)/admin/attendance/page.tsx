import Link from 'next/link';

import { classesForRollCall, rollCall, LATE_PENALTY_HOURS } from '@/lib/attendance';
import { formatDate } from '@/lib/format';
import { mark, markEveryonePresent } from './actions';

export const metadata = { title: 'Admin · Attendance' };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/** One of the three marks, plus a way back to unmarked. */
function MarkButtons({
  classId,
  userId,
  status,
}: {
  classId: string;
  userId: string;
  status: string | null;
}) {
  const options = [
    { value: 'present', label: 'Present' },
    { value: 'late', label: 'Late' },
    { value: 'absent', label: 'Absent' },
  ];

  return (
    <span className="marks">
      {options.map((o) => (
        <form key={o.value} action={mark}>
          <input type="hidden" name="classId" value={classId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="status" value={o.value} />
          <button
            type="submit"
            className={`mark mark--${o.value}${status === o.value ? ' is-on' : ''}`}
            aria-pressed={status === o.value}
          >
            {o.label}
          </button>
        </form>
      ))}
      {status ? (
        <form action={mark}>
          <input type="hidden" name="classId" value={classId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="status" value="clear" />
          <button type="submit" className="linkbtn" title="Back to unmarked">
            undo
          </button>
        </form>
      ) : null}
    </span>
  );
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;

  const classes = await classesForRollCall();
  // Default to the most recent class that has started — on the day of a class
  // that is the one you want, and afterwards it is the one still needing marks.
  const started = classes.find((k) => k.startDate <= new Date());
  const selectedId = c ?? started?.id ?? classes[0]?.id;
  const roll = selectedId ? await rollCall(selectedId) : null;

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Attendance</h1>
        {roll ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {roll.counts.present + roll.counts.late} of {roll.counts.booked} checked in
          </span>
        ) : null}
      </header>

      <div className="page">
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 640, marginBottom: 18 }}>
          Check students in on the day. Marking someone present awards the class CE hours
          automatically; a late arrival gets the class hours less {LATE_PENALTY_HOURS}. No-shows
          keep their record clean of hours they didn&rsquo;t earn.
        </p>

        {classes.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: 'center' }}>
            <p className="muted" style={{ marginBottom: 18 }}>
              No class has a booked seat yet, so there is nobody to check in.
            </p>
            <Link className="btn btn--outline btn--sm" href="/admin/classes">
              Manage classes
            </Link>
          </div>
        ) : (
          <>
            <div className="chiprow">
              {classes.map((k) => (
                <Link
                  key={k.id}
                  href={`/admin/attendance?c=${k.id}`}
                  className={`chip${k.id === selectedId ? ' is-on' : ''}`}
                >
                  {k.courseCode} · {k.dateLabel}
                  <span className="chip__count">
                    {/* A tick beats a fraction once the roll is done: the
                        question during a class is "is this one finished". */}
                    {k.complete ? '✓' : `${k.marked}/${k.booked}`}
                  </span>
                </Link>
              ))}
            </div>

            {roll ? (
              <>
                <div className="section-head" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <h2 className="display" style={{ fontSize: 20 }}>
                      {roll.title}
                    </h2>
                    <p className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {roll.dateLabel} · {roll.location} · {roll.ceHours} CE hours
                    </p>
                  </div>
                  {roll.counts.unmarked > 0 ? (
                    <form action={markEveryonePresent}>
                      <input type="hidden" name="classId" value={roll.classId} />
                      <button className="btn btn--dark btn--sm" type="submit">
                        Mark the remaining {roll.counts.unmarked} present
                      </button>
                    </form>
                  ) : null}
                </div>

                <div className="stat-row">
                  <div className="card stat-tile">
                    <span className="stat-tile__value">{roll.counts.booked}</span>
                    <span className="stat-tile__label">Booked</span>
                  </div>
                  <div className="card stat-tile">
                    <span className="stat-tile__value">{roll.counts.present}</span>
                    <span className="stat-tile__label">Present</span>
                  </div>
                  <div className="card stat-tile">
                    <span className="stat-tile__value">{roll.counts.late}</span>
                    <span className="stat-tile__label">Late</span>
                  </div>
                  <div className="card stat-tile">
                    <span className={`stat-tile__value${roll.counts.absent > 0 ? ' is-bad' : ''}`}>
                      {roll.counts.absent}
                    </span>
                    <span className="stat-tile__label">Absent</span>
                  </div>
                  <div className="card stat-tile">
                    <span className="stat-tile__value">{roll.hoursAwarded}</span>
                    <span className="stat-tile__label">CE hours awarded</span>
                  </div>
                </div>

                <div className="card table-wrap">
                  <div className="rtable">
                    <div className="rtable__head">
                      <span>Student</span>
                      <span>Company</span>
                      <span>Format</span>
                      <span>Hours</span>
                      <span>Check-in</span>
                    </div>

                    {roll.rows.map((r) => (
                      <div key={r.userId} className="rtable__row">
                        <span className="mtable__who">
                          <span className="avatar avatar--light">{initials(r.name)}</span>
                          <span className="mtable__name">
                            <Link href={`/admin/members/${r.userId}`}>{r.name}</Link>
                            <span className="faint mtable__email">{r.email}</span>
                          </span>
                        </span>
                        <span className="muted mtable__trunc">{r.company ?? '—'}</span>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {r.formatLabel}
                        </span>
                        <span style={{ fontWeight: 600 }} className={r.status ? '' : 'faint'}>
                          {r.status ? `${r.hours} hrs` : '—'}
                        </span>
                        <MarkButtons classId={roll.classId} userId={r.userId} status={r.status} />
                      </div>
                    ))}
                  </div>
                </div>

                <p className="faint" style={{ fontSize: 12, marginTop: 16, lineHeight: 1.6 }}>
                  Hours are worked out from the mark and the course&rsquo;s CE hours whenever this
                  is read, not stored against the student. Correct a course&rsquo;s hours and every
                  past roll follows, which is what you want when the number is the thing being
                  audited.
                  {' '}
                  Marked on {formatDate(roll.startDate)}.
                </p>
              </>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
