import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { classDiscount, discountedCents, TIER_LABEL, TIER } from '@/lib/access';
import { money, dateParts, seatsLabel } from '@/lib/format';
import { paypalConfigured } from '@/lib/paypal';
import { startPurchase } from '@/app/(app)/checkout/actions';
import { BuyButton } from '@/app/(app)/checkout/buy-button';

export const metadata = { title: 'Class schedule' };

export default async function SchedulePage() {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  // Only future, published classes — a past date on the schedule is noise.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [classes, myBookings] = await Promise.all([
    db.scheduledClass.findMany({
      where: { published: true, startDate: { gte: today } },
      orderBy: { startDate: 'asc' },
      select: {
        id: true, title: true, dateLabel: true, startDate: true, location: true,
        note: true, mode: true, seatsTotal: true,
        inPersonPriceCents: true, virtualPriceCents: true,
        course: { select: { slug: true, code: true } },
        _count: { select: { bookings: true } },
      },
    }),
    db.seatBooking.findMany({
      where: { userId: user.id },
      select: { classId: true, mode: true, paidCents: true },
    }),
  ]);

  const bookedByClass = new Map(myBookings.map((b) => [b.classId, b]));
  const purchasable = paypalConfigured();
  const discount = classDiscount(user.tier);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Class schedule</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {classes.length} upcoming
        </span>
      </header>

      <div className="page">
        {discount > 0 ? (
          <p className="alert alert--info">
            Your {TIER_LABEL[user.tier]} membership takes{' '}
            <strong>{Math.round(discount * 100)}% off</strong> every seat below. Discounted prices
            are shown.
          </p>
        ) : (
          <p className="alert alert--info">
            You&rsquo;re on {TIER_LABEL[user.tier]}. Pro takes 10% off every seat, Pro+ and Crew
            Leader take 20%.{' '}
            <a
              href="https://masterstouchacademy.com/membership"
              style={{ fontWeight: 600, color: 'var(--gold-deep)' }}
            >
              Compare plans
            </a>
          </p>
        )}

        {classes.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
              No dates on the calendar
            </h2>
            <p className="muted">
              The next term is being scheduled. Class dates will appear here as soon as they are set.
            </p>
          </div>
        ) : (
          classes.map((k) => {
            const { month, day } = dateParts(k.startDate);
            const booking = bookedByClass.get(k.id);
            const inPerson = k.inPersonPriceCents;
            const virtual = k.virtualPriceCents;
            const full = k._count.bookings >= k.seatsTotal;

            return (
              <article key={k.id} className="class-row card">
                <div className="class-row__date">
                  <span className="class-row__month">{month}</span>
                  <span className="class-row__day">{day}</span>
                </div>

                <div className="class-row__main">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <span className="badge">
                      {k.mode === 'hybrid'
                        ? 'Classroom or live stream'
                        : k.mode === 'inperson'
                          ? 'In-person only'
                          : 'Live stream'}
                    </span>
                    <span className="faint" style={{ fontSize: 12.5 }}>
                      {k.dateLabel}
                    </span>
                    {booking ? <span className="badge badge--done">Your seat booked</span> : null}
                  </div>

                  <h2 className="class-row__title">{k.title}</h2>
                  {k.note ? <p className="class-row__note">{k.note}</p> : null}
                  <p className="faint" style={{ fontSize: 12.5 }}>
                    {k.location} · {seatsLabel(k.seatsTotal, k._count.bookings)}
                  </p>
                </div>

                <div className="class-row__cta">
                  {booking ? (
                    <>
                      <p className="faint" style={{ fontSize: 12 }}>
                        Booked · {booking.mode === 'inperson' ? 'Classroom' : 'Live stream'}
                      </p>
                      <p style={{ fontSize: 18, fontWeight: 700 }}>{money(booking.paidCents)}</p>
                      <p className="faint" style={{ fontSize: 11.5 }}>paid</p>
                    </>
                  ) : (
                    <>
                      {inPerson !== null ? (
                        <PriceLine label="Classroom" cents={inPerson} tier={user.tier} />
                      ) : null}
                      {virtual !== null ? (
                        <PriceLine label="Live stream" cents={virtual} tier={user.tier} />
                      ) : null}
                      <div className="seat-buttons">
                        {inPerson !== null && k.mode !== 'virtual' ? (
                          <BuyButton
                            action={startPurchase}
                            fields={{ kind: 'class_seat', classId: k.id, seatMode: 'inperson' }}
                            label={full ? 'Fully booked' : 'Book a classroom seat'}
                            className="btn btn--dark btn--sm btn--block"
                            disabled={!purchasable || full}
                            disabledLabel={full ? 'Fully booked' : 'Booking unavailable'}
                          />
                        ) : null}
                        {virtual !== null && k.mode !== 'inperson' ? (
                          <BuyButton
                            action={startPurchase}
                            fields={{ kind: 'class_seat', classId: k.id, seatMode: 'virtual' }}
                            label="Book a live-stream seat"
                            className="btn btn--outline btn--sm btn--block"
                            disabled={!purchasable}
                            disabledLabel="Booking unavailable"
                          />
                        ) : null}
                      </div>
                      <Link
                        href={`/classroom/${k.course.slug}`}
                        className="faint"
                        style={{ fontSize: 12, display: 'block', marginTop: 8 }}
                      >
                        About this course →
                      </Link>
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

/** Shows the member's price, with the list price struck through when discounted. */
function PriceLine({ label, cents, tier }: { label: string; cents: number; tier: number }) {
  const net = discountedCents(cents, tier);
  const saved = cents !== net;

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', marginBottom: 4 }}>
      <span className="faint" style={{ fontSize: 12 }}>
        {label}
      </span>
      <span>
        {saved ? (
          <s className="faint" style={{ fontSize: 12, marginRight: 6 }}>
            {money(cents)}
          </s>
        ) : null}
        <strong style={{ fontSize: 16 }}>{money(net)}</strong>
      </span>
    </div>
  );
}
