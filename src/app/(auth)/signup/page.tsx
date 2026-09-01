import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { signUp } from './actions';
import { SignUpForm } from './form';

export const metadata = { title: 'Create an account' };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect('/classroom');

  return (
    <div className="auth">
      <div className="auth__brand">
        <span className="eyebrow" style={{ color: 'var(--gold)' }}>Create your account</span>
        <h1>Start with the community, free</h1>
        <p>
          Community membership costs nothing and never expires. Buy courses one at a time, or
          upgrade when the whole library is worth it to you.
        </p>
        <ul className="auth__perks">
          <li>Full community access, no card required</li>
          <li>Buy any course a la carte</li>
          <li>Your progress and certificates in one place</li>
        </ul>
      </div>

      <div className="auth__form">
        <div className="auth__form-inner">
          <h2>Create account</h2>
          <p className="muted" style={{ marginBottom: 26 }}>
            Already have one? <Link href="/signin" style={{ color: 'var(--gold-deep)', fontWeight: 600 }}>Sign in</Link>
          </p>
          <SignUpForm action={signUp} />
        </div>
      </div>
    </div>
  );
}
