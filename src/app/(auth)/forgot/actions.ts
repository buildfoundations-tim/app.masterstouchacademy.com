'use server';

import { z } from 'zod';

import { db } from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/tokens';

export type ForgotState = { error: string | null; sent?: boolean };

const Input = z.object({
  email: z.string().trim().toLowerCase().email('That email address does not look right.'),
});

/**
 * Request a password reset.
 *
 * Always reports the same thing, whether or not the address has an account.
 * A "no such user" here would turn the form into a membership directory.
 */
export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const parsed = Input.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter your email address.' };
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, firstName: true, passwordHash: true },
  });

  // Only send to an account that actually has a password to reset. An account
  // created by an admin and never activated should go through signup instead.
  if (user?.passwordHash) {
    await sendPasswordResetEmail(user).catch((e) => {
      console.error('reset email failed for', user.email, e);
    });
  }

  return { error: null, sent: true };
}
