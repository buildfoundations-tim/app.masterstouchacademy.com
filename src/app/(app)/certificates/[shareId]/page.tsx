import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Certificate' };

const fmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function CertificatePage({ params }: PageProps<'/certificates/[shareId]'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { shareId } = await params;

  const certificate = await db.certificate.findUnique({
    where: { shareId },
    select: {
      shareId: true,
      userId: true,
      issuedAt: true,
      ceHours: true,
      score: true,
      user: { select: { firstName: true, lastName: true } },
      course: { select: { title: true, code: true, group: true, hours: true } },
    },
  });

  if (!certificate) notFound();

  // This route is inside the authenticated group, so only the holder can open
  // it. A genuinely public verification page would live outside (app) and show
  // less — name, course, and date, but not the score. That is a later slice;
  // until then, do not link this URL as if it were shareable.
  if (certificate.userId !== user.id) notFound();

  const holder = `${certificate.user.firstName} ${certificate.user.lastName}`;

  return (
    <>
      <header className="topbar no-print">
        <Link href="/certificates" className="faint" style={{ fontSize: 13 }}>
          ← Certificates
        </Link>
        <h1 className="topbar__title" style={{ fontSize: 19 }}>
          {certificate.course.title}
        </h1>
      </header>

      <div className="page" style={{ maxWidth: 820 }}>
        <article className="certificate">
          <div className="certificate__rule" />
          <p className="certificate__eyebrow">Masters Touch Academy</p>
          <p className="certificate__intro">This certifies that</p>
          <h2 className="certificate__name">{holder}</h2>
          <p className="certificate__intro">has successfully completed</p>
          <h3 className="certificate__course">{certificate.course.title}</h3>

          <dl className="certificate__facts">
            <div>
              <dt>Credential</dt>
              <dd>{certificate.course.code}</dd>
            </div>
            <div>
              <dt>CE hours</dt>
              <dd>{certificate.ceHours}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{certificate.score}%</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{fmt.format(certificate.issuedAt)}</dd>
            </div>
          </dl>

          <p className="certificate__id">Certificate ID · {certificate.shareId}</p>
          <div className="certificate__rule" />
        </article>

        <div className="no-print" style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <Link className="btn btn--outline" href="/certificates">
            All certificates
          </Link>
        </div>

        {certificate.course.group === 'iicrc' ? (
          <p className="no-print muted" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.6 }}>
            This records completion of the course at Masters Touch Academy. The IICRC credential
            itself is issued by the IICRC once the certification exam is passed through them.
          </p>
        ) : null}
      </div>
    </>
  );
}
