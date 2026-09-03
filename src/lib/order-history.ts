/**
 * Reading orders back — for the member's own history and for Admin → Orders.
 *
 * Both views read the same shape so a receipt and the owner's record of it
 * cannot disagree. Amounts come from the OrderItem rows written at checkout,
 * never recomputed: a receipt must show what was actually charged, even after
 * a price change or a tier change. That is the one place in this codebase where
 * a stored price is the right answer rather than a stale one.
 */
import { db } from '@/lib/db';
import type { OrderStatus } from '@/generated/prisma/enums';

export type OrderLine = {
  description: string;
  listCents: number;
  unitCents: number;
  kind: 'course' | 'class_seat';
  courseSlug?: string;
};

export type OrderRecord = {
  id: string;
  paypalOrderId: string;
  paypalCaptureId: string | null;
  status: OrderStatus;
  totalCents: number;
  savedCents: number;
  placedAt: Date;
  capturedAt: Date | null;
  fulfilledAt: Date | null;
  refundedAt: Date | null;
  refundedCents: number | null;
  /** A refund smaller than the total. Access was deliberately left alone. */
  partiallyRefunded: boolean;
  error: string | null;
  lines: OrderLine[];
  /** Present on the admin view only. */
  buyer?: { id: string; name: string; email: string };
};

function toRecord(o: {
  id: string;
  paypalOrderId: string;
  paypalCaptureId: string | null;
  status: OrderStatus;
  totalCents: number;
  createdAt: Date;
  capturedAt: Date | null;
  fulfilledAt: Date | null;
  refundedAt: Date | null;
  refundedCents: number | null;
  error: string | null;
  items: Array<{
    description: string;
    listCents: number;
    unitCents: number;
    kind: string;
    course: { slug: string } | null;
  }>;
  user?: { id: string; firstName: string; lastName: string; email: string };
}): OrderRecord {
  return {
    id: o.id,
    paypalOrderId: o.paypalOrderId,
    paypalCaptureId: o.paypalCaptureId,
    status: o.status,
    totalCents: o.totalCents,
    savedCents: o.items.reduce((a, i) => a + (i.listCents - i.unitCents), 0),
    placedAt: o.createdAt,
    capturedAt: o.capturedAt,
    fulfilledAt: o.fulfilledAt,
    refundedAt: o.refundedAt,
    refundedCents: o.refundedCents,
    partiallyRefunded:
      o.refundedCents !== null && o.refundedCents > 0 && o.refundedCents < o.totalCents,
    error: o.error,
    lines: o.items.map((i) => ({
      description: i.description,
      listCents: i.listCents,
      unitCents: i.unitCents,
      kind: i.kind === 'class_seat' ? 'class_seat' : 'course',
      courseSlug: i.course?.slug,
    })),
    buyer: o.user
      ? {
          id: o.user.id,
          name: `${o.user.firstName} ${o.user.lastName}`.trim(),
          email: o.user.email,
        }
      : undefined,
  };
}

const ITEM_SELECT = {
  description: true,
  listCents: true,
  unitCents: true,
  kind: true,
  course: { select: { slug: true } },
} as const;

/** One member's orders, newest first. */
export async function ordersForMember(userId: string): Promise<OrderRecord[]> {
  const rows = await db.order.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { items: { select: ITEM_SELECT } },
  });
  return rows.map(toRecord);
}

/** One member's subscription history — separate from orders at PayPal. */
export async function subscriptionsForMember(userId: string) {
  return db.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      paypalSubscriptionId: true,
      status: true,
      tier: true,
      interval: true,
      priceCents: true,
      startedAt: true,
      currentPeriodEnd: true,
      cancelledAt: true,
      createdAt: true,
    },
  });
}

/**
 * Every order, for the owner.
 *
 * `created` orders are included deliberately: an order that was started and
 * never paid is exactly what the owner needs to see when a member says a
 * payment did not go through.
 */
export async function allOrders(opts: { search?: string; limit?: number } = {}): Promise<OrderRecord[]> {
  const search = opts.search?.trim();

  const rows = await db.order.findMany({
    where: search
      ? {
          OR: [
            { paypalOrderId: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { firstName: { contains: search, mode: 'insensitive' } } },
            { user: { lastName: { contains: search, mode: 'insensitive' } } },
            { items: { some: { description: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
    include: {
      items: { select: ITEM_SELECT },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return rows.map(toRecord);
}

/**
 * Headline numbers for Admin → Orders.
 *
 * `grossCents` is money taken and kept — refunds are subtracted, including the
 * partial ones, because the owner reads this tile as "what is in the account".
 * A number that ignored refunds would be wrong in the direction that matters.
 */
export async function orderTotals() {
  const [completed, failed, pending, refunded, sum, refundSum] = await Promise.all([
    db.order.count({ where: { status: 'completed' } }),
    db.order.count({ where: { status: 'failed' } }),
    db.order.count({ where: { status: 'created' } }),
    db.order.count({ where: { refundedAt: { not: null } } }),
    db.order.aggregate({
      where: { status: { in: ['completed', 'refunded'] } },
      _sum: { totalCents: true },
    }),
    db.order.aggregate({
      where: { refundedAt: { not: null } },
      _sum: { refundedCents: true },
    }),
  ]);

  const takenCents = sum._sum.totalCents ?? 0;
  const refundedCents = refundSum._sum.refundedCents ?? 0;

  return {
    completed,
    failed,
    pending,
    refunded,
    takenCents,
    refundedCents,
    grossCents: takenCents - refundedCents,
  };
}
