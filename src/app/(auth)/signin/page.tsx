import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { signIn } from './actions';
import { SignInForm } from './form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect('/classroom');

  const { next } = await searchParams;

  return (
    <div className="auth">
      <div className="auth__brand">
        <span className="eyebrow" style={{ color: 'var(--gold)' }}>
          Member sign in
        </span>
        <h1>Pick up where you left off</h1>
        <p>Your courses, progress, certificates, and CEC hours are waiting in the classroom.</p>
        <ul className="auth__perks">
          <li>Every course you own, on any device</li>
          <li>Progress, notes, and CEC hours in one place</li>
          <li>Certificates ready to download</li>
        </ul>
      </div>

      <div className="auth__form">
        <div className="auth__form-inner">
          <h2>Sign in</h2>
          <p className="muted" style={{ marginBottom: 28 }}>
            New here?{' '}
            <Link href="/signup" style={{ color: 'var(--gold-deep)', fontWeight: 600 }}>
              Create a free account
            </Link>
          </p>
          <SignInForm action={signIn} next={next} />
        </div>
      </div>
    </div>
  );
}
