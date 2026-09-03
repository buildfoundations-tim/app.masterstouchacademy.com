import Link from 'next/link';
import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { memberDetail } from '@/lib/members';
import { TIER_LABEL } from '@/lib/access';
import { money, formatDate } from '@/lib/format';
import { TierControl, GrantControl } from './controls';
import { revoke } from '../actions';

export const metadata = { title: 'Admin · Member' };

const SOURCE_LABEL: Record<string, string> = {
  purchase: 'Bought',
  membership: 'Included with their tier',
  grant: 'Granted by you',
};

export default async function AdminMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [member, courses] = await Promise.all([
    memberDetail(id),
    db.course.findMany({
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
      select: { id: true, code: true, title: true },
    }),
  ]);

  if (!member) notFound();

  const grants = member.entitlements.filter((e) => e.source === 'grant');
  const grantedCourseIds = new Set(grants.map((e) => e.course.id));

  return (
    <>
      <header className="topbar">
        <Link href="/admin/members" className="faint" style={{ fontSize: 13 }}>
          ← Members
        </Link>
        <h1 className="topbar__title">{member.name}</h1>
      </header>

      <div className="page" style={{ maxWidth: 980 }}>
        <div className="card admin-panel">
          <div className="member-head">
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Staff are named by what they are; members by what they pay for. */}
                <span
                  className={`badge${member.isStaff || member.tier >= 2 ? ' badge--done' : ' badge--locked'}`}
                >
                  {member.label}
                </span>
                {member.tierOverride !== null ? (
                  <span className="badge badge--locked">Set by hand</span>
                ) : null}
                {!member.emailVerifiedAt ? (
                  <span className="badge badge--bad">Email unconfirmed</span>
                ) : null}
              </div>
              <p className="faint" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.7 }}>
                {member.email}
                {member.phone ? ` · ${member.phone}` : ''}
                <br />
                {member.company ? `${member.company}` : 'No company on file'}
                {member.jobTitle ? ` · ${member.jobTitle}` : ''}
                {member.city ? ` · ${member.city}` : ''}
                <br />
                Joined {formatDate(member.createdAt)} ·{' '}
                {member.lastSeenAt ? `last seen ${formatDate(member.lastSeenAt)}` : 'never signed in'}
                {member.onboardedAt ? '' : ' · has not finished onboarding'}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 21, fontWeight: 700 }}>{money(member.spentCents)}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                spent
                {member.refundedCents > 0 ? `, ${money(member.refundedCents)} refunded` : ''}
              </div>
            </div>
          </div>
        </div>

        {member.isStaff ? (
          <p className="alert alert--info">
            This is a{member.role === 'owner' ? 'n owner' : 'n instructor'} account, not a
            membership. Staff run the school rather than subscribe to it, so there is no tier to
            set. They can open the CEC library; IICRC certification courses still have to be
            granted or bought, for staff as for everyone.
          </p>
        ) : (
          <TierControl
            userId={member.id}
            currentTier={member.tier}
            paidTier={member.paidTier}
            override={member.tierOverride}
            overrideReason={member.tierOverrideReason}
            tierLabels={TIER_LABEL}
          />
        )}

        <GrantControl
          userId={member.id}
          courses={courses.filter((c) => !grantedCourseIds.has(c.id))}
        />

        <div className="card admin-panel">
          <h2 className="admin-panel__title">Course access ({member.entitlements.length})</h2>
          {member.entitlements.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No course access yet.
            </p>
          ) : (
            <ul className="order-card__lines">
              {member.entitlements.map((e) => (
                <li key={e.id}>
                  <span>
                    <Link href={`/classroom/${e.course.slug}`}>
                      {e.course.code} — {e.course.title}
                    </Link>
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                      {SOURCE_LABEL[e.source] ?? e.source} · {formatDate(e.grantedAt)}
                      {e.expiresAt ? ` · expires ${formatDate(e.expiresAt)}` : ''}
                    </span>
                  </span>
                  {e.source === 'grant' ? (
                    // Only grants get a remove button. A purchase is undone by
                    // refunding in PayPal, not by an owner deleting the row.
                    <form action={revoke}>
                      <input type="hidden" name="userId" value={member.id} />
                      <input type="hidden" name="courseId" value={e.course.id} />
                      <button className="linkbtn linkbtn--danger" type="submit">
                        Remove grant
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card admin-panel">
          <h2 className="admin-panel__title">Membership</h2>
          {member.subscriptions.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No subscription — they have never bought a plan.
            </p>
          ) : (
            <ul className="order-card__lines">
              {member.subscriptions.map((s) => (
                <li key={s.paypalSubscriptionId}>
                  <span>
                    <span
                      className={`badge${s.status === 'active' ? ' badge--done' : ' badge--locked'}`}
                    >
                      {s.status}
                    </span>
                    <span style={{ marginLeft: 8 }}>
                      {TIER_LABEL[s.tier]} — {money(s.priceCents)} per{' '}
                      {s.interval === 'year' ? 'year' : 'month'}
                    </span>
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                      {s.status === 'active' && s.currentPeriodEnd
                        ? `renews ${formatDate(s.currentPeriodEnd)}`
                        : s.cancelledAt
                          ? `cancelled ${formatDate(s.cancelledAt)}`
                          : 'not active'}
                    </span>
                  </span>
                  <span className="faint" style={{ fontSize: 11 }}>
                    {s.paypalSubscriptionId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card admin-panel">
          <h2 className="admin-panel__title">Class seats ({member.seatBookings.length})</h2>
          {member.seatBookings.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No class seats booked.
            </p>
          ) : (
            <ul className="order-card__lines">
              {member.seatBookings.map((b) => (
                <li key={b.id}>
                  <span>
                    {b.class.title}
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                      {b.class.dateLabel} · {b.class.location} ·{' '}
                      {b.mode === 'virtual' ? 'live stream' : 'in the classroom'}
                    </span>
                  </span>
                  <span className="faint">{money(b.paidCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card admin-panel">
          <h2 className="admin-panel__title">Certificates ({member.certificates.length})</h2>
          {member.certificates.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              None issued yet.
            </p>
          ) : (
            <ul className="order-card__lines">
              {member.certificates.map((c) => (
                <li key={c.id}>
                  <span>
                    <Link href={`/certificates/${c.shareId}`}>
                      {c.course.code} — {c.course.title}
                    </Link>
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                      {formatDate(c.issuedAt)} · {c.ceHours} CE hrs · scored {c.score}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card admin-panel">
          <h2 className="admin-panel__title">Orders</h2>
          {member.orders.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              No orders.
            </p>
          ) : (
            <ul className="order-card__lines">
              {member.orders.map((o) => (
                <li key={o.id}>
                  <span>
                    <span
                      className={`badge${o.status === 'completed' ? ' badge--done' : o.status === 'refunded' ? ' badge--bad' : ' badge--locked'}`}
                    >
                      {o.status}
                    </span>
                    <span className="faint" style={{ marginLeft: 8, fontSize: 11.5 }}>
                      {formatDate(o.createdAt)} · {o.paypalOrderId}
                    </span>
                  </span>
                  <span className="faint">{money(o.totalCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
            <Link href={`/admin/orders?q=${encodeURIComponent(member.email)}`}>
              See these in full on Orders →
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
