/**
 * The notification list behind the bell in the app bar.
 *
 * There is no Notification table and deliberately so. Every notice here is a
 * *view* of a record that already exists — a seat booking, an order, an
 * entitlement about to lapse. Writing a second copy of that into a notification
 * row would create two things that can disagree, and the copy is the one that
 * goes stale. Derived means a cancelled class stops nagging the member the
 * moment it is cancelled, with no cleanup job to forget to write.
 *
 * The cost is that read/unread cannot live per-notice, so it lives per-member:
 * `user.notificationsReadAt`. Anything that happened after that stamp is
 * unread. It is coarser than per-item read state and it is honest — the bell
 * says "something has happened since you last looked", which is what a bell is
 * for.
 *
 * No `server-only`: the test suite calls these directly.
 */
import { db } from '@/lib/db';
import type { UserRole } from '@/generated/prisma/enums';

export type Notice = {
  id: string;
  title: string;
  body?: string;
  href: string;
  /** When the underlying thing happened. Drives ordering and unread state. */
  at: Date;
  tone: 'info' | 'good' | 'warn';
  unread: boolean;
};

/** Sorted to the top regardless of age. */
type Raw = Omit<Notice, 'unread'> & { pinned?: boolean };

const DAY = 86_400_000;

function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / DAY);
}

function inDays(n: number): string {
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

/**
 * Everything worth telling this member about, newest first.
 *
 * Capped at `limit` after sorting so the popover cannot grow without bound on
 * a long-standing account.
 */
export async function noticesFor(
  user: {
    id: string;
    role: UserRole;
    emailVerifiedAt: Date | null;
    notificationsReadAt: Date | null;
    createdAt?: Date;
  },
  limit = 12
): Promise<Notice[]> {
  const readAt = user.notificationsReadAt;
  const now = new Date();
  const soon = new Date(Date.now() + 30 * DAY);

  const [bookings, orders, expiring, unfulfilled] = await Promise.all([
    // Classes the member holds a seat in that have not happened yet.
    db.seatBooking.findMany({
      where: { userId: user.id, class: { startDate: { gte: now, lte: soon } } },
      include: { class: { select: { title: true, startDate: true, dateLabel: true, location: true } } },
      orderBy: { class: { startDate: 'asc' } },
    }),

    // Recent money events. Both directions — a refund is news too.
    db.order.findMany({
      where: {
        userId: user.id,
        status: { in: ['completed', 'refunded'] },
        OR: [
          { capturedAt: { gte: new Date(Date.now() - 90 * DAY) } },
          { refundedAt: { gte: new Date(Date.now() - 90 * DAY) } },
        ],
      },
      select: { id: true, status: true, totalCents: true, capturedAt: true, refundedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),

    // Access that lapses soon. The member can only act on this if they know.
    db.entitlement.findMany({
      where: { userId: user.id, expiresAt: { gte: now, lte: soon } },
      include: { course: { select: { slug: true, title: true } } },
      orderBy: { expiresAt: 'asc' },
    }),

    // Owner only: someone paid and did not get what they paid for.
    user.role === 'owner'
      ? db.order.findMany({
          where: { status: 'completed', fulfilledAt: null },
          select: { id: true, capturedAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  const notices: Raw[] = [];

  if (!user.emailVerifiedAt) {
    notices.push({
      id: 'verify-email',
      title: 'Confirm your email address',
      body: 'Certificates and class confirmations are sent by email, so this one matters.',
      href: '/verify',
      // Pinned to the top: an unverified address is a standing problem, not an
      // event, so it must not sink below older news. Its timestamp is still the
      // account's own age rather than "now" — dating it now would make it
      // permanently unread and the badge impossible to clear.
      at: user.createdAt ?? new Date(0),
      tone: 'warn',
      pinned: true,
    });
  }

  for (const b of bookings) {
    const days = daysUntil(b.class.startDate);
    notices.push({
      id: `class-${b.id}`,
      title: `${b.class.title} starts ${inDays(days)}`,
      body: `${b.class.dateLabel} · ${b.class.location}`,
      href: '/schedule',
      at: b.bookedAt,
      tone: days <= 3 ? 'warn' : 'info',
    });
  }

  for (const o of orders) {
    if (o.status === 'refunded' && o.refundedAt) {
      notices.push({
        id: `refund-${o.id}`,
        title: 'Your order was refunded',
        body: 'The money is on its way back to your PayPal account, and the access it paid for has been removed.',
        href: '/orders',
        at: o.refundedAt,
        tone: 'warn',
      });
    } else if (o.status === 'completed' && o.capturedAt) {
      notices.push({
        id: `paid-${o.id}`,
        title: 'Payment received — your access is open',
        href: '/orders',
        at: o.capturedAt,
        tone: 'good',
      });
    }
  }

  for (const e of expiring) {
    notices.push({
      id: `expiring-${e.id}`,
      title: `Access to ${e.course.title} ends ${inDays(daysUntil(e.expiresAt!))}`,
      body: 'Finish the course or renew before it closes.',
      href: `/classroom/${e.course.slug}`,
      // Dated by expiry, not by grant: this becomes news as the date nears.
      at: e.expiresAt!,
      tone: 'warn',
    });
  }

  for (const o of unfulfilled) {
    notices.push({
      id: `unfulfilled-${o.id}`,
      title: 'An order was paid but not fulfilled',
      body: 'A member paid and did not receive access. Needs attention.',
      href: '/admin/orders',
      at: o.capturedAt ?? o.createdAt,
      tone: 'warn',
    });
  }

  return notices
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.at.getTime() - a.at.getTime();
    })
    .slice(0, limit)
    .map(({ pinned: _pinned, ...n }) => ({ ...n, unread: !readAt || n.at > readAt }));
}

/** Just the badge number — the layout renders on every page, so keep it cheap. */
export async function unreadNoticeCount(user: {
  id: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  notificationsReadAt: Date | null;
}): Promise<number> {
  const notices = await noticesFor(user);
  return notices.filter((n) => n.unread).length;
}

export async function markNoticesRead(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { notificationsReadAt: new Date() },
  });
}
