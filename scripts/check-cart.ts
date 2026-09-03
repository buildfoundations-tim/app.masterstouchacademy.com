/**
 * Exercises the cart.
 *
 * The property under test throughout: a cart line stores WHAT, never HOW MUCH.
 * Price, discount and availability are recomputed from the catalog and the
 * member's tier every time the cart is read, so a tier change or newly gained
 * access is reflected rather than frozen when the item was added.
 *
 *   npx tsx scripts/check-cart.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { getCart, addCourseToCart, addSeatToCart, addMembershipToCart, removeFromCart, clearCart, pricedForCheckout } from '../src/lib/cart';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

async function main() {
  const member = await db.user.findUniqueOrThrow({ where: { email: 'community@example.com' } });
  const wrt = await db.course.findUniqueOrThrow({ where: { slug: 'wrt' } });
  const cct = await db.course.findUniqueOrThrow({ where: { slug: 'cct' } });
  const cec = await db.course.findUniqueOrThrow({ where: { slug: 'cecupholstery' } });
  const klass = await db.scheduledClass.findFirstOrThrow({ where: { published: true } });

  // Clean slate.
  await clearCart(member.id);
  await db.entitlement.deleteMany({ where: { userId: member.id } });
  await db.seatBooking.deleteMany({ where: { userId: member.id } });
  await db.user.update({ where: { id: member.id }, data: { tier: 1 } });

  const tier1 = { id: member.id, tier: 1 };

  console.log('\nAdding items:');
  check('add WRT', (await addCourseToCart(tier1, wrt.id)).ok, true);
  check('add CCT', (await addCourseToCart(tier1, cct.id)).ok, true);
  let cart = await getCart(tier1);
  check('two lines', cart.lines.length, 2);
  check('both buyable', cart.buyableCount, 2);
  check('total is $450 + $325 at list', cart.totalCents, 45000 + 32500);
  check('no discount at tier 1', cart.savingCents, 0);

  console.log('\nDuplicates are not added twice:');
  await addCourseToCart(tier1, wrt.id);
  cart = await getCart(tier1);
  check('still two lines', cart.lines.length, 2);

  console.log('\nPrice follows the tier, not the moment of adding:');
  await db.user.update({ where: { id: member.id }, data: { tier: 2 } });
  const tier2 = { id: member.id, tier: 2 };
  cart = await getCart(tier2);
  check('same two lines', cart.lines.length, 2);
  check('total now 10% off', cart.totalCents, Math.round(45000 * 0.9) + Math.round(32500 * 0.9));
  check('saving reported', cart.savingCents, 45000 + 32500 - cart.totalCents);
  check('list subtotal unchanged', cart.subtotalListCents, 45000 + 32500);

  console.log('\nA CEC course becomes unavailable when the tier includes it:');
  await db.user.update({ where: { id: member.id }, data: { tier: 1 } });
  check('tier 1 may add the CEC course', (await addCourseToCart({ id: member.id, tier: 1 }, cec.id)).ok, true);
  cart = await getCart({ id: member.id, tier: 1 });
  check('three lines, all buyable', [cart.lines.length, cart.buyableCount], [3, 3]);

  // Upgrading to Pro includes the CEC library — that line is now unbuyable.
  cart = await getCart({ id: member.id, tier: 2 });
  check('as Pro it is still listed', cart.lines.length, 3);
  check('but not buyable', cart.buyableCount, 2);
  check('one flagged unavailable', cart.unavailableCount, 1);
  const flagged = cart.lines.find((l) => !l.available);
  check('with a reason the member can act on', flagged?.reason, 'You already have access to this course.');
  check('and it is excluded from the total', cart.totalCents, Math.round(45000 * 0.9) + Math.round(32500 * 0.9));

  console.log('\nCheckout prices fresh and skips the unbuyable:');
  const co = await pricedForCheckout({ id: member.id, tier: 2 });
  check('two lines go to PayPal', co.lines.length, 2);
  check('one skipped', co.skipped.length, 1);
  check('total matches the cart', co.totalCents, cart.totalCents);

  console.log('\nClass seats:');
  await clearCart(member.id);
  check('add a classroom seat', (await addSeatToCart(tier1, klass.id, 'inperson')).ok, true);
  cart = await getCart(tier1);
  check('one line', cart.lines.length, 1);
  check('priced at the classroom rate', cart.lines[0].unitCents, klass.inPersonPriceCents);

  // Changing format replaces rather than stacking — one seat per class.
  check('switch to live stream', (await addSeatToCart(tier1, klass.id, 'virtual')).ok, true);
  cart = await getCart(tier1);
  check('still one line', cart.lines.length, 1);
  check('now at the live-stream rate', cart.lines[0].unitCents, klass.virtualPriceCents);

  console.log('\nRemoving:');
  await removeFromCart(member.id, cart.lines[0].id);
  cart = await getCart(tier1);
  check('cart is empty', cart.lines.length, 0);
  check('empty total is zero', cart.totalCents, 0);

  console.log("\nOne member cannot remove another's line:");
  await addCourseToCart(tier1, wrt.id);
  cart = await getCart(tier1);
  const otherUser = await db.user.findFirstOrThrow({ where: { email: { not: member.email } } });
  await removeFromCart(otherUser.id, cart.lines[0].id);
  check('line survives a removal scoped to someone else', (await getCart(tier1)).lines.length, 1);

  console.log('\nA membership in the cart re-prices everything else:');
  await clearCart(member.id);
  await db.user.update({ where: { id: member.id }, data: { tier: 1 } });
  const t1 = { id: member.id, tier: 1 };

  await addCourseToCart(t1, wrt.id);
  cart = await getCart(t1);
  check('WRT at list for a Community member', cart.totalCents, 45000);
  check('no membership line yet', cart.membership, null);
  check('priced at tier 1', cart.pricedAtTier, 1);

  check('add Pro monthly', (await addMembershipToCart(member.id, 'pro-monthly')).ok, true);
  cart = await getCart(t1);
  check('membership line appears', cart.membership?.key, 'pro-monthly');
  check('it is recurring, not a one-off line', cart.lines.find(l => l.kind === 'membership')?.recurring, true);
  check('other lines now priced at tier 2', cart.pricedAtTier, 2);
  check('WRT drops to the Pro price', cart.totalCents, Math.round(45000 * 0.9));
  check('the saving is reported', cart.membershipSavingCents, 45000 - Math.round(45000 * 0.9));

  console.log('\nThe membership is never part of the one-off charge:');
  const coM = await pricedForCheckout(t1);
  check('only the course goes to the Orders API', coM.lines.length, 1);
  check(
    'and at the TRUE tier, not the prospective one',
    coM.totalCents,
    45000
  );

  console.log('\nA higher plan wins; a lower one never raises prices:');
  await addMembershipToCart(member.id, 'crew-monthly');
  cart = await getCart(t1);
  check('replaced, still one membership', cart.lines.filter(l => l.kind === 'membership').length, 1);
  check('Crew Leader prices at tier 4', cart.pricedAtTier, 4);
  check('WRT at 20% off', cart.totalCents, Math.round(45000 * 0.8));

  // A Pro member adding a Pro plan must not be re-priced downward.
  await addMembershipToCart(member.id, 'pro-monthly');
  cart = await getCart({ id: member.id, tier: 3 });
  check('an existing Pro+ member keeps their better rate', cart.pricedAtTier, 3);

  // Reset.
  await clearCart(member.id);
  await db.entitlement.deleteMany({ where: { userId: member.id } });
  await db.user.update({ where: { id: member.id }, data: { tier: 1 } });
  console.log('\n  (cart, entitlements and tier reset)');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
