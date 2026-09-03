import Link from 'next/link';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { consumeToken } from '@/lib/tokens';
import { resendVerification } from './actions';
import { ResendButton } from './resend-button';

export const metadata = { title: 'Confirm your email' };

/**
 * Lands from the link in the verification email.
 *
 * Redeeming happens here rather than in an action because the link is a plain
 * GET from an email client. The token is single-use, so a mail scanner that
 * pre-fetches links will burn it — hence the explicit "already used" case,
 * which tells the member their address is confirmed rather than showing a
 * failure for something that actually worked.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const user = await getSessionUser();

  let state: 'ok' | 'expired' | 'used' | 'invalid' | 'no-token' = 'no-token';

  if (token) {
    const result = await consumeToken(token, 'email_verification');
    if (result.ok) {
      await db.user.update({
        where: { id: result.userId },
        data: { emailVerifiedAt: new Date() },
      });
      state = 'ok';
    } else {
      state = result.reason;
    }
  }

  // A token that was already redeemed on a verified account is a success from
  // the member's point of view.
  const alreadyVerified = state === 'used' && user?.emailVerifiedAt != null;

  return (
    <div className="auth">
      <div className="auth__brand">
        <span className="eyebrow" style={{ color: 'var(--gold)' }}>Email confirmation</span>
        <h1>{state === 'ok' || alreadyVerified ? 'You’re confirmed' : 'Confirm your email'}</h1>
        <p>
          Confirming your address lets us send certificates, class reminders, and receipts
          somewhere you will actually see them.
        </p>
      </div>

      <div className="auth__form">
        <div className="auth__form-inner">
          {state === 'ok' || alreadyVerified ? (
            <>
              <h2>Email confirmed</h2>
              <p className="muted" style={{ marginBottom: 24, lineHeight: 1.7 }}>
                Thanks — that address is verified.
              </p>
              <Link className="btn btn--dark btn--block" href={user ? '/classroom' : '/signin'}>
                {user ? 'Go to the classroom' : 'Sign in'}
              </Link>
            </>
          ) : (
            <>
              <h2>
                {state === 'expired'
                  ? 'That link expired'
                  : state === 'used'
                    ? 'A newer link replaced this one'
                    : state === 'invalid'
                      ? 'That link is not valid'
                      : 'Confirm your email'}
              </h2>
              <p className="muted" style={{ marginBottom: 22, lineHeight: 1.7 }}>
                {state === 'no-token'
                  ? 'Open the link from the email we sent you. If it never arrived, send a new one.'
                  : state === 'used'
                    ? 'Requesting another email replaces the previous link, so only the most recent one works. Open the newest email in your inbox — or send a fresh one below.'
                    : 'Verification links work once and expire after 24 hours. Send yourself a fresh one.'}
              </p>

              {user ? (
                <ResendButton action={resendVerification} />
              ) : (
                <Link className="btn btn--dark btn--block" href="/signin">
                  Sign in to resend
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
