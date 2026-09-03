import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { getCart } from '@/lib/cart';
import { classDiscount, TIER_LABEL } from '@/lib/access';
import { paypalConfigured } from '@/lib/paypal';
import { money } from '@/lib/format';
import { checkoutCart, removeItem, startMembershipFromCart } from './actions';
import { CheckoutPanel } from './checkout-panel';
import { CheckoutButton } from './checkout-button';

export const metadata = { title: 'Cart' };

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<{ membership?: string }>;
}) {
  const { membership: membershipFlag } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const cart = await getCart(user);
  const discount = classDiscount(user.tier);
  const purchasable = paypalConfigured();
  const paypalClientId = process.env.PAYPAL_CLIENT_ID ?? null;

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Cart</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {cart.lines.length === 0
            ? 'empty'
            : `${cart.lines.length} item${cart.lines.length === 1 ? '' : 's'}`}
        </span>
      </header>

      <div className="page" style={{ maxWidth: 900 }}>
        {membershipFlag === 'started' ? (
          <p className="alert alert--info">
            Thanks — PayPal is activating your membership. Once it confirms, the prices below drop
            to the member rate. Refresh in a moment if they have not yet.
          </p>
        ) : membershipFlag === 'cancelled' ? (
          <p className="alert alert--info">
            The membership was not started, so nothing was charged. It is still in your cart.
          </p>
        ) : null}

        {cart.lines.length === 0 ? (
          <div className="card" style={{ padding: 34, textAlign: 'center' }}>
            <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
              Your cart is empty
            </h2>
            <p className="muted" style={{ marginBottom: 22 }}>
              Add a certification course or a seat on an upcoming class.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link className="btn btn--dark" href="/classroom">
                Browse courses
              </Link>
              <Link className="btn btn--outline" href="/schedule">
                Class schedule
              </Link>
            </div>
          </div>
        ) : (
          <div className="cart-layout">
            <section>
              {cart.lines.map((line) => (
                <article
                  key={line.id}
                  className={`card cart-line${line.available ? '' : ' cart-line--unavailable'}`}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span className="badge">
                        {line.kind === 'course' ? 'Course' : 'Class seat'}
                      </span>
                      {!line.available ? (
                        <span className="badge badge--locked">Unavailable</span>
                      ) : null}
                    </div>
                    <h2 className="cart-line__title">{line.description}</h2>
                    {line.available ? null : (
                      <p className="cart-line__reason">{line.reason}</p>
                    )}
                  </div>

                  <div className="cart-line__price">
                    {line.kind === 'membership' ? (
                      <>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{money(line.unitCents)}</div>
                        <span className="faint" style={{ fontSize: 11.5 }}>
                          per {line.interval === 'year' ? 'year' : 'month'}
                        </span>
                      </>
                    ) : line.available ? (
                      <>
                        {line.listCents !== line.unitCents ? (
                          <s className="faint" style={{ fontSize: 12.5 }}>
                            {money(line.listCents)}
                          </s>
                        ) : null}
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{money(line.unitCents)}</div>
                      </>
                    ) : (
                      <span className="faint" style={{ fontSize: 12.5 }}>
                        not charged
                      </span>
                    )}
                    <form action={removeItem}>
                      <input type="hidden" name="cartItemId" value={line.id} />
                      <button className="linkbtn" type="submit">
                        Remove
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </section>

            <aside>
              <div className="card cart-summary">
                <h2 className="display" style={{ fontSize: 20, marginBottom: 14 }}>
                  Summary
                </h2>

                {cart.membership ? (
                  <div className="cart-summary__row cart-summary__row--sub">
                    <span>{cart.membership.label} membership</span>
                    <span>
                      {money(cart.membership.chargeCents)}/
                      {cart.membership.interval === 'year' ? 'yr' : 'mo'}
                    </span>
                  </div>
                ) : null}

                <div className="cart-summary__row">
                  <span>
                    {cart.buyableCount} item{cart.buyableCount === 1 ? '' : 's'}
                  </span>
                  <span>{money(cart.subtotalListCents)}</span>
                </div>

                {cart.savingCents > 0 ? (
                  <div className="cart-summary__row cart-summary__row--save">
                    <span>
                      {TIER_LABEL[user.tier]} discount ({Math.round(discount * 100)}%)
                    </span>
                    <span>−{money(cart.savingCents)}</span>
                  </div>
                ) : null}

                <div className="cart-summary__row cart-summary__row--total">
                  <span>{cart.membership ? 'One-off total' : 'Total'}</span>
                  <span>{money(cart.totalCents)}</span>
                </div>

                {cart.membership && cart.membershipSavingCents > 0 ? (
                  <p className="cart-note">
                    Prices above are the {TIER_LABEL[cart.pricedAtTier]} rate — adding the
                    membership saves <strong>{money(cart.membershipSavingCents)}</strong> on this
                    cart. Start the membership first and the discount applies to the rest.
                  </p>
                ) : null}

                {cart.unavailableCount > 0 ? (
                  <p className="alert alert--info" style={{ marginTop: 14, marginBottom: 0, fontSize: 12.5 }}>
                    {cart.unavailableCount} item{cart.unavailableCount === 1 ? '' : 's'} cannot be
                    bought right now and {cart.unavailableCount === 1 ? 'is' : 'are'} not included in
                    the total.
                  </p>
                ) : null}

                {cart.membership ? (
                  <div className="membership-first">
                    <p className="faint" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
                      A membership is billed on a schedule, so PayPal takes it as a separate
                      transaction from one-off items. Start it first — you will come back here to
                      buy the rest at the member rate.
                    </p>
                    <CheckoutButton
                      action={startMembershipFromCart}
                      disabled={!purchasable}
                      label={`Start ${cart.membership.label} — ${money(cart.membership.chargeCents)}/${cart.membership.interval === 'year' ? 'yr' : 'mo'}`}
                    />
                  </div>
                ) : null}

                <div style={{ marginTop: 16 }}>
                  <CheckoutPanel
                    action={checkoutCart}
                    clientId={paypalClientId}
                    disabled={!purchasable || cart.buyableCount === 0}
                    label={
                      cart.buyableCount === 0
                        ? 'Nothing to check out'
                        : `Check out — ${money(cart.totalCents)}`
                    }
                  />
                </div>

                <p className="faint" style={{ fontSize: 11.5, marginTop: 12, textAlign: 'center' }}>
                  Secure checkout via PayPal
                </p>

                {discount === 0 ? (
                  <p className="faint" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
                    Pro takes 10% off, Pro+ and Crew Leader 20%.{' '}
                    <Link href="/membership" style={{ color: 'var(--gold-deep)', fontWeight: 600 }}>
                      Compare plans
                    </Link>
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
