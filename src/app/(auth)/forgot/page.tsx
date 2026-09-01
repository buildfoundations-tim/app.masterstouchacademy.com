import Link from 'next/link';

import { requestReset } from './actions';
import { ForgotForm } from './form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPage() {
  return (
    <div className="auth">
      <div className="auth__brand">
        <span className="eyebrow" style={{ color: 'var(--gold)' }}>Password reset</span>
        <h1>Happens to everyone</h1>
        <p>Give us the email on your account and we&rsquo;ll send a link to set a new password.</p>
      </div>
      <div className="auth__form">
        <div className="auth__form-inner">
          <h2>Reset your password</h2>
          <p className="muted" style={{ marginBottom: 26 }}>
            Remembered it? <Link href="/signin" style={{ color: 'var(--gold-deep)', fontWeight: 600 }}>Sign in</Link>
          </p>
          <ForgotForm action={requestReset} />
        </div>
      </div>
    </div>
  );
}
