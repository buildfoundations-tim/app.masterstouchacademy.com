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
import { findPlanByKey, type Plan } from '@/lib/billing';

export type CartLine = {
  id: string;
  kind: 'course' | 'class_seat' | 'membership';
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
  /** Set on a membership line. */
  planKey?: string;
  /** Charged by PayPal separately, on its own schedule. */
  recurring?: boolean;
  interval?: string;
};

export type CartView = {
  lines: CartLine[];
  /** The membership line, if one is in the cart. */
  membership: (Plan & { lineId: string }) | null;
  /**
   * The tier the other lines are priced at. Equal to the member's current tier
   * unless a membership is in the cart, in which case it is the tier that
   * membership would grant — so the cart shows what the bundle actually costs.
   */
  pricedAtTier: number;
  /** What the discount would be worth if the membership is taken first. */
  membershipSavingCents: number;
  /** Buyable lines only. */
  subtotalListCents: number;
  totalCents: number;
  savingCents: number;
  buyableCount: number;
  unavailableCount: number;
};

/**
 * Read the cart, pricing every line against the catalog as it stands now.
 *
 * If a membership is in the cart, the other lines are priced at the tier that
 * membership would grant rather than the tier the member holds today. That is
 * the point of putting it in the cart: a course bought alongside Pro should
 * show the Pro price, not the price they would pay without it.
 *
 * The member is never charged that price by accident. pricedForCheckout()
 * prices against their ACTUAL tier, which only moves once PayPal reports the
 * subscription active — so the discount is real by the time it applies.
 */
export async function getCart(user: { id: string; tier: number }): Promise<CartView> {
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    orderBy: { addedAt: 'asc' },
    include: {
      course: { select: { slug: true, title: true } },
      class: { select: { title: true } },
    },
  });

  const membershipItem = items.find((i) => i.kind === 'membership');
  const plan = membershipItem?.planKey ? findPlanByKey(membershipItem.planKey) : undefined;

  // Price against the better of what they hold and what the cart would grant.
  // Never below their current tier — taking a cheaper plan than the one they
  // already pay for must not raise the price of everything else.
  const pricedAtTier = plan ? Math.max(user.tier, plan.tier) : user.tier;
  const pricingUser = { id: user.id, tier: pricedAtTier };

  const lines: CartLine[] = [];

  for (const item of items) {
    if (item.kind === 'membership') {
      if (!plan) continue; // plan key no longer recognised — skip silently
      lines.push({
        id: item.id,
        kind: 'membership',
        available: true,
        description: `${plan.label} membership`,
        listCents: plan.chargeCents,
        unitCents: plan.chargeCents,
        planKey: plan.key,
        recurring: true,
        interval: plan.interval,
      });
      continue;
    }

    const priced = item.kind === 'course'
      ? await pricePurchase(pricingUser, { kind: 'course', courseId: item.courseId! })
      : await pricePurchase(pricingUser, {
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

  // The membership is billed by PayPal on its own schedule, so it is not part
  // of the one-off total. Keeping the two apart is what stops the cart implying
  // a single charge that PayPal cannot actually take.
  const oneOff = lines.filter((l) => l.available && l.kind !== 'membership');

  // What the membership is worth on this cart, had they not taken it.
  let membershipSavingCents = 0;
  if (plan && pricedAtTier !== user.tier) {
    const atCurrentTier = { id: user.id, tier: user.tier };
    for (const item of items) {
      if (item.kind === 'membership') continue;
      const before = item.kind === 'course'
        ? await pricePurchase(atCurrentTier, { kind: 'course', courseId: item.courseId! })
        : await pricePurchase(atCurrentTier, {
            kind: 'class_seat',
            classId: item.classId!,
            seatMode: item.seatMode === 'inperson' ? 'inperson' : 'virtual',
          });
      if (before.ok) membershipSavingCents += before.line.unitCents;
    }
    membershipSavingCents -= oneOff.reduce((a, l) => a + l.unitCents, 0);
    if (membershipSavingCents < 0) membershipSavingCents = 0;
  }

  return {
    lines,
    membership: plan && membershipItem ? { ...plan, lineId: membershipItem.id } : null,
    pricedAtTier,
    membershipSavingCents,
    subtotalListCents: oneOff.reduce((a, l) => a + l.listCents, 0),
    totalCents: oneOff.reduce((a, l) => a + l.unitCents, 0),
    savingCents: oneOff.reduce((a, l) => a + (l.listCents - l.unitCents), 0),
    buyableCount: oneOff.length,
    unavailableCount: lines.filter((l) => !l.available).length,
  };
}

/** Put a membership plan in the cart, replacing any already there. */
export async function addMembershipToCart(
  userId: string,
  planKey: string
): Promise<AddResult> {
  const plan = findPlanByKey(planKey);
  if (!plan) return { ok: false, reason: 'That plan is not available.' };

  await db.cartItem.deleteMany({ where: { userId, kind: 'membership' } });
  await db.cartItem.create({ data: { userId, kind: 'membership', planKey: plan.key } });
  return { ok: true };
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
 * The lines to actually charge for, priced fresh against the member's ACTUAL
 * tier — not the prospective one the cart displays.
 *
 * This is the safety on the whole membership-in-cart idea. The cart may show a
 * course at the Pro price because Pro is sitting in the cart beside it, but
 * nothing is charged at that price until PayPal reports the subscription active
 * and the tier genuinely moves. Showing a discount is not the same as granting
 * one.
 *
 * Also re-priced rather than reusing what was rendered: the page may have been
 * open for an hour.
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
    // A membership is not an order line — it checks out through the
    // Subscriptions API separately. Including it here would put a recurring
    // charge into a one-off capture.
    if (item.kind === 'membership') continue;

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
