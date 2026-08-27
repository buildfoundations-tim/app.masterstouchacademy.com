import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Certificates' };

const fmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function CertificatesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const certificates = await db.certificate.findMany({
    where: { userId: user.id },
    orderBy: { issuedAt: 'desc' },
    select: {
      shareId: true,
      issuedAt: true,
      ceHours: true,
      score: true,
      course: { select: { title: true, code: true, group: true } },
    },
  });

  const totalCeHours = certificates.reduce((acc, c) => acc + c.ceHours, 0);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Certificates</h1>
        {certificates.length > 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {totalCeHours} CE hours recorded
          </span>
        ) : null}
      </header>

      <div className="page">
        {certificates.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
              No certificates yet
            </h2>
            <p className="muted" style={{ marginBottom: 20 }}>
              Finish a course and pass its final exam — the certificate is issued automatically,
              with your CE hours recorded on it.
            </p>
            <Link className="btn btn--dark" href="/classroom">
              Go to the classroom
            </Link>
          </div>
        ) : (
          <div className="grid grid--3">
            {certificates.map((c) => (
              <Link key={c.shareId} href={`/certificates/${c.shareId}`} className="course">
                <div className="course__media">{c.course.code}</div>
                <div className="course__body">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="badge badge--done">{c.score}%</span>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {c.ceHours} CE hours
                    </span>
                  </div>
                  <h2 className="course__title">{c.course.title}</h2>
                  <div className="course__foot">
                    <span className="faint" style={{ fontSize: 12 }}>
                      {fmt.format(c.issuedAt)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold-deep)' }}>
                      View →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
