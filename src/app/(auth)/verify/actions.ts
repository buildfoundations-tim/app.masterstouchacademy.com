'use server';

import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { sendVerificationEmail } from '@/lib/tokens';

export type ResendState = { error: string | null; sent?: boolean };

/** Send a fresh verification link to the signed-in member's address. */
export async function resendVerification(
  _prev: ResendState,
  _formData: FormData
): Promise<ResendState> {
  const session = await getSessionUser();
  if (!session) redirect('/signin');

  const user = await db.user.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
  });
  if (!user) redirect('/signin');

  if (user.emailVerifiedAt) {
    return { error: null, sent: true };
  }

  // issueToken supersedes any earlier unused link, so repeated clicks do not
  // leave a trail of live keys in the inbox.
  try {
    await sendVerificationEmail(user);
  } catch (e) {
    // Log the real reason. The member gets a vague message on purpose, but
    // discarding it entirely is what made a broken SMTP setup invisible.
    console.error('[mail] resend verification failed for', user.email, e);
    return { error: 'We could not send that just now. Try again in a moment.' };
  }

  return { error: null, sent: true };
}
