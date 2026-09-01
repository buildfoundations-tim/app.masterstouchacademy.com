import Link from 'next/link';

import { resetPassword } from './actions';
import { ResetForm } from './form';

export const metadata = { title: 'Set a new password' };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="auth">
      <div className="auth__brand">
        <span className="eyebrow" style={{ color: 'var(--gold)' }}>Password reset</span>
        <h1>Set a new password</h1>
        <p>Choosing a new password signs you out on every other device.</p>
      </div>
      <div className="auth__form">
        <div className="auth__form-inner">
          <h2>New password</h2>
          {token ? (
            <ResetForm action={resetPassword} token={token} />
          ) : (
            <>
              <p className="alert alert--error">
                This page needs a reset link. Open the link from your email, or request a new one.
              </p>
              <Link className="btn btn--dark btn--block" href="/forgot">Request a reset link</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
