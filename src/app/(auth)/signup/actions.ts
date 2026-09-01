'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import { createSession, hashPassword } from '@/lib/auth';
import { sendAccountExistsEmail, sendVerificationEmail } from '@/lib/tokens';

export type SignUpState = { error: string | null; sent?: boolean };

const SignUpInput = z.object({
  firstName: z.string().trim().min(1, 'Tell us your first name.').max(60),
  lastName: z.string().trim().min(1, 'Tell us your last name.').max(60),
  email: z.string().trim().toLowerCase().email('That email address does not look right.'),
  company: z.string().trim().max(120).optional(),
  // 10 is the practical floor recommended by current NIST guidance; length
  // does far more work than composition rules, so there are none.
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/**
 * Create an account.
 *
 * The response is identical whether or not the address already has an account,
 * and an email goes out either way — a verification link to a new account, or a
 * "you already have one" note to the existing owner. That keeps this form from
 * being used to discover who is a member, without the usual cost of that
 * choice: the real person still gets a usable next step in their inbox.
 *
 * The consequence worth knowing: a genuinely new signup is logged straight in,
 * an existing-account attempt is not. That difference is only observable to
 * someone who already controls the mailbox.
 */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = SignUpInput.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email'),
    company: formData.get('company') || undefined,
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const { firstName, lastName, email, company, password } = parsed.data;

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true },
  });

  if (existing) {
    // Same visible outcome as success. The owner of the address gets told.
    await sendAccountExistsEmail(existing).catch(() => {});
    return { error: null, sent: true };
  }

  const user = await db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName,
      lastName,
      company: company ?? null,
      // Everyone starts on Community. Tier only ever changes through a
      // verified PayPal subscription — see src/lib/subscriptions.ts.
      tier: 1,
      settings: { create: {} },
    },
    select: { id: true, email: true, firstName: true },
  });

  // A failed welcome email must not fail the signup — the account exists and
  // the member can request another link from /verify.
  await sendVerificationEmail(user).catch((e) => {
    console.error('verification email failed for', user.email, e);
  });

  const h = await headers();
  await createSession(user.id, {
    userAgent: h.get('user-agent'),
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  redirect('/classroom?welcome=1');
}
