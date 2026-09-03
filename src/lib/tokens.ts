import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { headers } from 'next/headers';

import { db } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import type { TokenPurpose } from '@/generated/prisma/enums';

/**
 * Single-use tokens for email verification and password resets.
 *
 * Same discipline as sessions: the raw token goes in the email, only its
 * SHA-256 is stored. A database leak yields hashes, not working links.
 *
 * Lifetimes differ on purpose. A verification link is a convenience and can
 * live for a day; a reset link is a key to the account and should not.
 */

const LIFETIME_MS: Record<TokenPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000, // 24 hours
  password_reset: 60 * 60 * 1000, //  1 hour
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function appOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Issue a token, invalidating any earlier unused ones for the same purpose.
 *
 * Superseding matters: without it, every "resend verification" click leaves
 * another live key to the account lying in an inbox.
 */
export async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  await db.verificationToken.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString('base64url');

  await db.verificationToken.create({
    data: {
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]),
    },
  });

  return token;
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * Redeem a token exactly once.
 *
 * Marking it used happens in the same updateMany that checks it is unused, so
 * two simultaneous requests cannot both succeed — the second updates zero rows.
 */
export async function consumeToken(token: string, purpose: TokenPurpose): Promise<ConsumeResult> {
  if (!token) return { ok: false, reason: 'invalid' };

  const record = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, purpose: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.purpose !== purpose) return { ok: false, reason: 'invalid' };
  if (record.usedAt) return { ok: false, reason: 'used' };
  if (record.expiresAt <= new Date()) return { ok: false, reason: 'expired' };

  const claimed = await db.verificationToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: 'used' };

  return { ok: true, userId: record.userId };
}

// ── The two emails this app sends ────────────────────────────

/**
 * Send, and fail loudly if it did not go.
 *
 * sendMail() reports failure by RETURNING { ok: false }, never by throwing.
 * Awaiting it without checking swallowed every SMTP error: signup succeeded,
 * nothing was logged, and no email arrived — indistinguishable from success.
 * Callers wrap these in .catch() to log, so throwing is what makes that work.
 */
async function sendOrThrow(msg: Parameters<typeof sendMail>[0]): Promise<void> {
  const result = await sendMail(msg);
  if (!result.ok) {
    throw new Error(
      `mail send failed via ${result.transport}: ${result.error ?? 'unknown error'}`
    );
  }
}

export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  firstName: string;
}): Promise<void> {
  const token = await issueToken(user.id, 'email_verification');
  const link = `${await appOrigin()}/verify?token=${encodeURIComponent(token)}`;

  await sendOrThrow({
    to: user.email,
    subject: 'Confirm your email — Masters Touch Academy',
    text:
      `Hi ${user.firstName},\n\n` +
      `Confirm your email address to finish setting up your Masters Touch Academy account:\n\n` +
      `${link}\n\n` +
      `The link works once and expires in 24 hours.\n\n` +
      `If you didn't create an account, you can ignore this — nothing will happen.`,
  });
}

export async function sendPasswordResetEmail(user: {
  id: string;
  email: string;
  firstName: string;
}): Promise<void> {
  const token = await issueToken(user.id, 'password_reset');
  const link = `${await appOrigin()}/reset?token=${encodeURIComponent(token)}`;

  await sendOrThrow({
    to: user.email,
    subject: 'Reset your password — Masters Touch Academy',
    text:
      `Hi ${user.firstName},\n\n` +
      `Someone asked to reset the password on your Masters Touch Academy account. ` +
      `If that was you, set a new one here:\n\n` +
      `${link}\n\n` +
      `The link works once and expires in an hour. Resetting your password signs you ` +
      `out everywhere else.\n\n` +
      `If this wasn't you, ignore this email — your password has not changed.`,
  });
}

/**
 * Sent when someone tries to sign up with an address that already has an
 * account. The signup form shows the same message either way, so this email is
 * what stops that being a dead end for the real owner of the address — and it
 * is why the form cannot be used to discover who has an account.
 */
export async function sendAccountExistsEmail(user: {
  email: string;
  firstName: string;
}): Promise<void> {
  const origin = await appOrigin();
  await sendOrThrow({
    to: user.email,
    subject: 'You already have an account — Masters Touch Academy',
    text:
      `Hi ${user.firstName},\n\n` +
      `Someone just tried to create a Masters Touch Academy account with this email ` +
      `address, but you already have one.\n\n` +
      `Sign in here: ${origin}/signin\n` +
      `Forgotten your password? ${origin}/forgot\n\n` +
      `If this wasn't you, nothing has changed and no new account was created.`,
  });
}
