'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { authenticate, createSession } from '@/lib/auth';

const SignInInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type SignInState = { error: string | null };

/**
 * Sign in. Every failure path returns the same message on purpose — a distinct
 * "no such account" would turn this endpoint into an account-enumeration oracle.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = SignInInput.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return { error: 'Enter your email address and password.' };
  }

  const userId = await authenticate(parsed.data.email, parsed.data.password);
  if (!userId) {
    return { error: 'That email and password combination did not work.' };
  }

  const h = await headers();
  await createSession(userId, {
    userAgent: h.get('user-agent'),
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  // Only ever redirect to a path on this app — an attacker-supplied absolute
  // URL here would make the sign-in page an open redirect.
  const target = parsed.data.next;
  const safeTarget = target && target.startsWith('/') && !target.startsWith('//') ? target : '/classroom';

  redirect(safeTarget);
}
