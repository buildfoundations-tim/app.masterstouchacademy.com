import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { ordersForMember, subscriptionsForMember } from '@/lib/order-history';
import { TIER_LABEL } from '@/lib/access';
import { money, formatDate } from '@/lib/format';

export const metadata = { title: 'Orders' };

const STATUS_LABEL: Record<string, string> = {
  completed: 'Paid',
  created: 'Not completed',
  approved: 'Approved',
  failed: 'Failed',
  refunded: 'Refunded',
};

export default async function OrdersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const [orders, subs] = await Promise.all([
    ordersForMember(user.id),
    subscriptionsForMember(user.id),
  ]);

  const paid = orders.filter((o) => o.status === 'completed');
  const spentCents = paid.reduce((a, o) => a + o.totalCents, 0);
  const savedCents = paid.reduce((a, o) => a + o.savedCents, 0);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Orders</h1>
        {paid.length > 0 ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {money(spentCents)} across {paid.length} order{paid.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      <div className="page" style={{ maxWidth: 860 }}>
        {orders.length === 0 && subs.length === 0 ? (
          <div className="card" style={{ padding: 34, textAlign: 'center' }}>
            <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
              Nothing here yet
            </h2>
            <p className="muted" style={{ marginBottom: 22 }}>
              Courses and class seats you buy will appear here with their receipts.
            </p>
            <Link className="btn btn--dark" href="/classroom">
              Browse courses
            </Link>
          </div>
        ) : null}

        {savedCents > 0 ? (
          <p className="alert alert--info">
            Your {TIER_LABEL[user.tier]} membership has saved you{' '}
            <strong>{money(savedCents)}</strong> on these orders.
          </p>
        ) : null}

        {subs.length > 0 ? (
          <>
            <h2 className="display" style={{ fontSize: 20, margin: '4px 0 12px' }}>
              Membership
            </h2>
            {subs.map((s) => (
              <article key={s.paypalSubscriptionId} className="card order-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span className={`badge${s.status === 'active' ? ' badge--done' : ' badge--locked'}`}>
                      {s.status}
                    </span>
                    <span className="faint" style={{ fontSize: 12.5 }}>
                      {formatDate(s.startedAt ?? s.createdAt)}
                    </span>
                  </div>
                  <h3 className="order-row__title">
                    {TIER_LABEL[s.tier]} — {money(s.priceCents)} per{' '}
                    {s.interval === 'year' ? 'year' : 'month'}
                  </h3>
                  <p className="faint" style={{ fontSize: 12 }}>
                    {s.status === 'active' && s.currentPeriodEnd
                      ? `Renews ${formatDate(s.currentPeriodEnd)}`
                      : s.cancelledAt
                        ? `Cancelled ${formatDate(s.cancelledAt)}`
                        : 'Not active'}
                    {' · '}
                    {s.paypalSubscriptionId}
                  </p>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <Link className="btn btn--outline btn--sm" href="/membership">
                    Manage
                  </Link>
                </div>
              </article>
            ))}
          </>
        ) : null}

        {orders.length > 0 ? (
          <>
            <h2 className="display" style={{ fontSize: 20, margin: '28px 0 12px' }}>
              Purchases
            </h2>

            {orders.map((o) => (
              <article key={o.id} className="card order-card">
                <div className="order-card__head">
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span
                        className={`badge${o.status === 'completed' ? ' badge--done' : o.status === 'refunded' ? ' badge--bad' : ' badge--locked'}`}
                      >
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                      <span className="faint" style={{ fontSize: 12.5 }}>
                        {formatDate(o.placedAt)}
                      </span>
                    </div>
                    <p className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
                      Order {o.paypalOrderId}
                      {o.paypalCaptureId ? ` · payment ${o.paypalCaptureId}` : ''}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontSize: 19,
                        fontWeight: 700,
                        textDecoration: o.status === 'refunded' ? 'line-through' : undefined,
                      }}
                    >
                      {money(o.totalCents)}
                    </div>
                    {o.refundedCents ? (
                      <div className="faint" style={{ fontSize: 11.5 }}>
                        {money(o.refundedCents)} refunded
                      </div>
                    ) : null}
                    {o.savedCents > 0 ? (
                      <div className="faint" style={{ fontSize: 11.5 }}>
                        saved {money(o.savedCents)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <ul className="order-card__lines">
                  {o.lines.map((l, i) => (
                    <li key={i}>
                      <span>
                        {l.courseSlug && (o.status === 'completed' || o.partiallyRefunded) ? (
                          <Link href={`/classroom/${l.courseSlug}`}>{l.description}</Link>
                        ) : (
                          l.description
                        )}
                      </span>
                      <span className="faint">
                        {l.listCents !== l.unitCents ? (
                          <s style={{ marginRight: 6 }}>{money(l.listCents)}</s>
                        ) : null}
                        {money(l.unitCents)}
                      </span>
                    </li>
                  ))}
                </ul>

                {o.status === 'created' ? (
                  <p className="order-card__note">
                    This order was started but never paid, so nothing was charged and nothing was
                    granted. You can buy the items again from the catalogue.
                  </p>
                ) : null}
                {o.status === 'refunded' ? (
                  <p className="order-card__note">
                    This order was refunded on {formatDate(o.refundedAt!)}. The money has gone back
                    to your PayPal account, and the courses and seats it paid for have been removed.
                    Refunds usually appear within a few business days.
                  </p>
                ) : null}
                {o.partiallyRefunded ? (
                  <p className="order-card__note">
                    Part of this order — {money(o.refundedCents!)} — was refunded on{' '}
                    {formatDate(o.refundedAt!)}. Your access is unchanged. Get in touch if that is
                    not what you expected.
                  </p>
                ) : null}
                {o.status === 'failed' ? (
                  <p className="order-card__note order-card__note--bad">
                    This payment did not complete. If money left your account, contact us and we
                    will resolve it.
                  </p>
                ) : null}
              </article>
            ))}
          </>
        ) : null}
      </div>
    </>
  );
}
