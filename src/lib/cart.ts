/**
 * The cart.
 *
 * Every line is priced by pricePurchase() at read time and again at checkout.
 * Nothing about cost is stored on a CartItem, so a price change, a tier change,
 * or access gained in the meantime is reflected rather than frozen at the
 * moment the item was added.
 *
 * That also means a line can become unbuyable while it sits there — the course
 * was included in a membership the member has since taken, a class filled up,
 * a date passed. Those lines are surfaced as unavailable rather than silently
 * dropped, so the member understands why the total changed.
 *
 * No `server-only` here: the test suite exercises these directly.
 */
import { db } from '@/lib/db';
import { pricePurchase, type PricedLine } from '@/lib/pricing';

export type CartLine = {
  id: string;
  kind: 'course' | 'class_seat';
  /** Priced and buyable right now. */
  available: boolean;
  /** Why not, when unavailable — shown to the member. */
  reason?: string;
  description: string;
  listCents: number;
  unitCents: number;
  /** For linking back to the thing itself. */
  courseSlug?: string;
  classId?: string;
  seatMode?: string;
};

export type CartView = {
  lines: CartLine[];
  /** Buyable lines only. */
  subtotalListCents: number;
  totalCents: number;
  savingCents: number;
  buyableCount: number;
  unavailableCount: number;
};

/** Read the cart, pricing every line against the catalog as it stands now. */
export async function getCart(user: { id: string; tier: number }): Promise<CartView> {
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    orderBy: { addedAt: 'asc' },
    include: {
      course: { select: { slug: true, title: true } },
      class: { select: { title: true } },
    },
  });

  const lines: CartLine[] = [];

  for (const item of items) {
    const priced = item.kind === 'course'
      ? await pricePurchase(user, { kind: 'course', courseId: item.courseId! })
      : await pricePurchase(user, {
          kind: 'class_seat',
          classId: item.classId!,
          seatMode: item.seatMode === 'inperson' ? 'inperson' : 'virtual',
        });

    if (priced.ok) {
      lines.push({
        id: item.id,
        kind: item.kind,
        available: true,
        description: priced.line.description,
        listCents: priced.line.listCents,
        unitCents: priced.line.unitCents,
        courseSlug: item.course?.slug,
        classId: item.classId ?? undefined,
        seatMode: item.seatMode ?? undefined,
      });
    } else {
      lines.push({
        id: item.id,
        kind: item.kind,
        available: false,
        reason: priced.reason,
        description: item.course?.title ?? item.class?.title ?? 'Item',
        listCents: 0,
        unitCents: 0,
        courseSlug: item.course?.slug,
        classId: item.classId ?? undefined,
        seatMode: item.seatMode ?? undefined,
      });
    }
  }

  const buyable = lines.filter((l) => l.available);

  return {
    lines,
    subtotalListCents: buyable.reduce((a, l) => a + l.listCents, 0),
    totalCents: buyable.reduce((a, l) => a + l.unitCents, 0),
    savingCents: buyable.reduce((a, l) => a + (l.listCents - l.unitCents), 0),
    buyableCount: buyable.length,
    unavailableCount: lines.length - buyable.length,
  };
}

/** Number of items, for the top-bar badge. Cheap — no pricing. */
export function cartCount(userId: string): Promise<number> {
  return db.cartItem.count({ where: { userId } });
}

export type AddResult = { ok: true } | { ok: false; reason: string };

/**
 * Add a course. Refuses anything the member could not buy anyway, so the
 * failure is explained at the point of clicking rather than at checkout.
 */
export async function addCourseToCart(
  user: { id: string; tier: number },
  courseId: string
): Promise<AddResult> {
  const priced = await pricePurchase(user, { kind: 'course', courseId });
  if (!priced.ok) return { ok: false, reason: priced.reason };

  // Check before inserting. Relying on the unique violation worked, but Prisma
  // logs it at error level first — an expected path should not look like a
  // fault in the logs. The constraint still stands as the race guard.
  const existing = await db.cartItem.findFirst({
    where: { userId: user.id, courseId },
    select: { id: true },
  });
  if (existing) return { ok: true };

  try {
    await db.cartItem.create({ data: { userId: user.id, kind: 'course', courseId } });
  } catch {
    // Lost a race with another tab. It is in the cart either way.
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Add a class seat. A member holds at most one seat per class, so adding a
 * second format replaces the first rather than stacking.
 */
export async function addSeatToCart(
  user: { id: string; tier: number },
  classId: string,
  seatMode: 'inperson' | 'virtual'
): Promise<AddResult> {
  const priced = await pricePurchase(user, { kind: 'class_seat', classId, seatMode });
  if (!priced.ok) return { ok: false, reason: priced.reason };

  const existing = await db.cartItem.findFirst({
    where: { userId: user.id, classId },
    select: { id: true },
  });

  if (existing) {
    await db.cartItem.update({ where: { id: existing.id }, data: { seatMode } });
    return { ok: true };
  }

  try {
    await db.cartItem.create({
      data: { userId: user.id, kind: 'class_seat', classId, seatMode },
    });
  } catch {
    // Lost a race with another tab. It is in the cart either way.
    return { ok: true };
  }
  return { ok: true };
}

/** Remove one line. Scoped to the owner so an id from elsewhere does nothing. */
export async function removeFromCart(userId: string, cartItemId: string): Promise<void> {
  await db.cartItem.deleteMany({ where: { id: cartItemId, userId } });
}

export async function clearCart(userId: string): Promise<void> {
  await db.cartItem.deleteMany({ where: { userId } });
}

/**
 * The lines to actually charge for, priced fresh.
 *
 * Called at checkout rather than reusing what was rendered: the page may have
 * been open for an hour, and the total the member is sent to PayPal with must
 * be the one computed now.
 */
export async function pricedForCheckout(user: {
  id: string;
  tier: number;
}): Promise<{ lines: PricedLine[]; totalCents: number; skipped: string[] }> {
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    orderBy: { addedAt: 'asc' },
  });

  const lines: PricedLine[] = [];
  const skipped: string[] = [];

  for (const item of items) {
    const priced = item.kind === 'course'
      ? await pricePurchase(user, { kind: 'course', courseId: item.courseId! })
      : await pricePurchase(user, {
          kind: 'class_seat',
          classId: item.classId!,
          seatMode: item.seatMode === 'inperson' ? 'inperson' : 'virtual',
        });

    if (priced.ok) lines.push(priced.line);
    else skipped.push(priced.reason);
  }

  return {
    lines,
    totalCents: lines.reduce((a, l) => a + l.unitCents, 0),
    skipped,
  };
}
