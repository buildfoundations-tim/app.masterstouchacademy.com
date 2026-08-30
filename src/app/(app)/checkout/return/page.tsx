import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { settleOrder } from '@/lib/orders';
import { money } from '@/lib/format';

export const metadata = { title: 'Purchase' };

/**
 * Where PayPal sends the buyer after they approve a one-time purchase.
 *
 * Same rule as the subscription return page: the token in the URL is a hint.
 * It is matched against an order belonging to THIS member, and the capture is
 * then performed and verified server-side. Nothing is granted on the strength
 * of the redirect alone.
 */
export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const { token } = await searchParams;

  let state: 'done' | 'pending' | 'failed' | 'unknown' = 'unknown';
  let detail: string | null = null;
  let bought: { description: string; unitCents: number; courseSlug?: string } | null = null;

  if (token) {
    const order = await db.order.findFirst({
      where: { paypalOrderId: token, userId: user.id },
      include: { items: { include: { course: { select: { slug: true } } } } },
    });

    if (order) {
      const result = await settleOrder(token);

      if (result.ok) {
        state = 'done';
        const item = order.items[0];
        bought = item
          ? {
              description: item.description,
              unitCents: item.unitCents,
              courseSlug: item.course?.slug,
            }
          : null;
      } else if (result.reason.startsWith('not-completed')) {
        state = 'pending';
      } else {
        state = 'failed';
        detail = result.reason;
      }
    }
  }

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Purchase</h1>
      </header>

      <div className="page" style={{ maxWidth: 620 }}>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          {state === 'done' ? (
            <>
              <span className="badge badge--done" style={{ fontSize: 12 }}>
                Paid
              </span>
              <h2 className="display" style={{ fontSize: 28, margin: '16px 0 10px' }}>
                You&rsquo;re all set
              </h2>
              {bought ? (
                <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                  {bought.description} — {money(bought.unitCents)}. A receipt is in your PayPal
                  account.
                </p>
              ) : null}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {bought?.courseSlug ? (
                  <Link className="btn btn--dark" href={`/classroom/${bought.courseSlug}`}>
                    Open the course
                  </Link>
                ) : (
                  <Link className="btn btn--dark" href="/schedule">
                    View the schedule
                  </Link>
                )}
                <Link className="btn btn--outline" href="/classroom">
                  Classroom
                </Link>
              </div>
            </>
          ) : state === 'pending' ? (
            <>
              <h2 className="display" style={{ fontSize: 26, marginBottom: 10 }}>
                Payment not finished
              </h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                PayPal has not completed this payment yet. If you approved it, it will land
                shortly and access opens automatically. Nothing has been charged twice.
              </p>
              <Link className="btn btn--dark" href="/classroom">
                Back to the classroom
              </Link>
            </>
          ) : state === 'failed' ? (
            <>
              <h2 className="display" style={{ fontSize: 26, marginBottom: 10 }}>
                Something went wrong
              </h2>
              <p className="muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
                We couldn&rsquo;t complete that purchase. If money left your account, it has not
                been kept — contact us and we will sort it out straight away.
              </p>
              <p className="faint" style={{ fontSize: 11.5, marginBottom: 22 }}>
                Reference: {detail}
              </p>
              <a className="btn btn--dark" href="https://masterstouchacademy.com/contact">
                Contact us
              </a>
            </>
          ) : (
            <>
              <h2 className="display" style={{ fontSize: 26, marginBottom: 10 }}>
                We couldn&rsquo;t find that purchase
              </h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                There is no order matching that reference on your account.
              </p>
              <Link className="btn btn--dark" href="/classroom">
                Back to the classroom
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
