import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { allOrders, orderTotals } from '@/lib/order-history';
import { money, formatDate } from '@/lib/format';

export const metadata = { title: 'Admin · Orders' };

const STATUS_LABEL: Record<string, string> = {
  completed: 'Paid',
  created: 'Not completed',
  approved: 'Approved',
  failed: 'Failed',
  refunded: 'Refunded',
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { q } = await searchParams;
  const [orders, totals] = await Promise.all([allOrders({ search: q }), orderTotals()]);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Orders</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {money(totals.grossCents)} across {totals.completed} paid
        </span>
      </header>

      <div className="page">
        <div className="stat-row">
          <div className="card stat-tile">
            <span className="stat-tile__value">{money(totals.grossCents)}</span>
            <span className="stat-tile__label">
              {totals.refundedCents > 0 ? `Kept, after ${money(totals.refundedCents)} refunded` : 'Taken'}
            </span>
          </div>
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.completed}</span>
            <span className="stat-tile__label">Paid orders</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.pending}</span>
            <span className="stat-tile__label">Started, not paid</span>
          </div>
          <div className="card stat-tile">
            <span className={`stat-tile__value${totals.failed > 0 ? ' is-bad' : ''}`}>
              {totals.failed}
            </span>
            <span className="stat-tile__label">Failed</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.refunded}</span>
            <span className="stat-tile__label">Refunded</span>
          </div>
        </div>

        <form method="get" className="admin-search">
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by member, email, order id, or item"
          />
          <button className="btn btn--outline btn--sm" type="submit">
            Search
          </button>
          {q ? (
            <Link className="btn btn--outline btn--sm" href="/admin/orders">
              Clear
            </Link>
          ) : null}
        </form>

        {orders.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: 'center' }}>
            <p className="muted">
              {q ? `Nothing matches “${q}”.` : 'No orders yet.'}
            </p>
          </div>
        ) : (
          orders.map((o) => (
            <article key={o.id} className="card order-card">
              <div className="order-card__head">
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span
                      className={`badge${o.status === 'completed' ? ' badge--done' : o.status === 'failed' || o.status === 'refunded' ? ' badge--bad' : ' badge--locked'}`}
                    >
                      {STATUS_LABEL[o.status] ?? o.status}
                    </span>
                    {o.partiallyRefunded ? (
                      <span className="badge badge--bad">Part refunded</span>
                    ) : null}
                    <strong style={{ fontSize: 14 }}>{o.buyer?.name}</strong>
                    <span className="faint" style={{ fontSize: 12.5 }}>
                      {o.buyer?.email}
                    </span>
                  </div>
                  <p className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
                    {formatDate(o.placedAt)} · order {o.paypalOrderId}
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
                      {money(o.refundedCents)} refunded {formatDate(o.refundedAt!)}
                    </div>
                  ) : null}
                  {o.savedCents > 0 ? (
                    <div className="faint" style={{ fontSize: 11.5 }}>
                      after {money(o.savedCents)} discount
                    </div>
                  ) : null}
                </div>
              </div>

              <ul className="order-card__lines">
                {o.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.description}</span>
                    <span className="faint">
                      {l.listCents !== l.unitCents ? (
                        <s style={{ marginRight: 6 }}>{money(l.listCents)}</s>
                      ) : null}
                      {money(l.unitCents)}
                    </span>
                  </li>
                ))}
              </ul>

              {o.error ? (
                <p className="order-card__note order-card__note--bad">
                  {/* The stored reason, verbatim — this is the owner's view and a
                      vague message here would waste their time. */}
                  {o.error}
                </p>
              ) : null}

              {o.partiallyRefunded ? (
                <p className="order-card__note order-card__note--bad">
                  Part of this order was refunded. Access was <strong>not</strong> withdrawn — a
                  partial refund does not say which line it covers, so that call is yours. Remove
                  the entitlement by hand if it should go.
                </p>
              ) : null}

              {o.status === 'completed' && !o.fulfilledAt ? (
                <p className="order-card__note order-card__note--bad">
                  Captured but not fulfilled — this member paid and did not receive access.
                  Needs attention.
                </p>
              ) : null}
            </article>
          ))
        )}

        <p className="faint" style={{ fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
          Refunds are issued in PayPal, not here — this screen reads them back. Refunding there
          sends a webhook; a <strong>full</strong> refund marks the order refunded and withdraws the
          courses and class seats it granted. A <strong>partial</strong> refund is recorded and
          flagged, but access is left alone for you to decide.
        </p>
      </div>
    </>
  );
}
