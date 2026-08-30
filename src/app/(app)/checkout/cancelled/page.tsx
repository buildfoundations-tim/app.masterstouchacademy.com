import Link from 'next/link';

export const metadata = { title: 'Checkout cancelled' };

export default function CheckoutCancelledPage() {
  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Checkout cancelled</h1>
      </header>
      <div className="page" style={{ maxWidth: 560 }}>
        <div className="card" style={{ padding: 30, textAlign: 'center' }}>
          <h2 className="display" style={{ fontSize: 24, marginBottom: 10 }}>
            Nothing was charged
          </h2>
          <p className="muted" style={{ marginBottom: 22, lineHeight: 1.7 }}>
            You backed out at PayPal, so no payment was taken and nothing has changed.
          </p>
          <Link className="btn btn--dark" href="/classroom">
            Back to the classroom
          </Link>
        </div>
      </div>
    </>
  );
}
