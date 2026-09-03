/**
 * Authentication: password hashing and server-side sessions.
 *
 * Design notes worth keeping:
 *   - Passwords are argon2id, the current OWASP recommendation.
 *   - The session cookie holds a random opaque token. Only its SHA-256 hash is
 *     stored, so a database leak does not hand an attacker live sessions.
 *   - The cookie is httpOnly + sameSite=lax + secure in production, so it is
 *     unreadable from JS and not sent on cross-site POSTs.
 *   - Sign-in failures are deliberately indistinguishable: the same message and
 *     a hash verification even when the user does not exist, so the endpoint
 *     cannot be used to enumerate accounts or timed to detect them.
 */
import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

import { db } from '@/lib/db';

const COOKIE_NAME = 'mta_session';
const SESSION_DAYS = 30;

/**
 * A real argon2id hash of a random value, used to burn the same CPU time when
 * an email does not exist as when it does. Computed once per process.
 */
let decoyHashPromise: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoyHashPromise ??= argonHash(randomBytes(32).toString('hex'));
  return decoyHashPromise;
}

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash.
    return false;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a session row and set the cookie. Returns the raw token. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ip: meta.ip ?? null,
    },
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return token;
}

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  tier: number;
  isOwner: boolean;
  isInstructor: boolean;
  onboardedAt: Date | null;
  emailVerifiedAt: Date | null;
  notificationsReadAt: Date | null;
  createdAt: Date;
};

/**
 * The signed-in user, or null. Safe to call from any server component or route
 * handler; it reads the cookie and one indexed row.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          displayName: true,
          tier: true,
          isOwner: true,
          isInstructor: true,
          onboardedAt: true,
          emailVerifiedAt: true,
          notificationsReadAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    // Clean up as we go rather than relying on a sweeper existing.
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session.user;
}

/** Destroy the current session and clear the cookie. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;

  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
  }
  jar.delete(COOKIE_NAME);
}

/**
 * Verify an email/password pair. Returns the user id on success, null on
 * failure — with the same work done either way so timing does not leak whether
 * the account exists.
 */
export async function authenticate(email: string, password: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, passwordHash: true },
  });

  if (!user?.passwordHash) {
    await verifyPassword(await decoyHash(), password);
    return null;
  }

  const ok = await verifyPassword(user.passwordHash, password);
  return ok ? user.id : null;
}

/** Constant-time compare for CSRF tokens and similar opaque values. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
