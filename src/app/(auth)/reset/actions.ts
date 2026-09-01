'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { consumeToken } from '@/lib/tokens';

export type ResetState = { error: string | null };

const Input = z.object({
  token: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  confirm: z.string(),
});

/**
 * Set a new password from a reset link.
 *
 * Every existing session is destroyed on success. If the reset was prompted by
 * a compromise, leaving the attacker's session alive would defeat the point.
 */
export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = Input.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: 'Those two passwords do not match.' };
  }

  const result = await consumeToken(parsed.data.token, 'password_reset');
  if (!result.ok) {
    return {
      error:
        result.reason === 'expired'
          ? 'That reset link has expired. Request a new one.'
          : result.reason === 'used'
            ? 'That reset link has already been used. Request a new one.'
            : 'That reset link is not valid. Request a new one.',
    };
  }

  await db.$transaction([
    db.user.update({
      where: { id: result.userId },
      data: { passwordHash: await hashPassword(parsed.data.password) },
    }),
    // Sign out everywhere.
    db.session.deleteMany({ where: { userId: result.userId } }),
  ]);

  redirect('/signin?reset=1');
}
