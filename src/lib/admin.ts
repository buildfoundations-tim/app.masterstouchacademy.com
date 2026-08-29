import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { getSessionUser, type SessionUser } from '@/lib/auth';

/**
 * Guard for admin server actions.
 *
 * The /admin layout gates the pages, but a server action is a public endpoint —
 * it can be invoked without the layout ever running. Every admin action calls
 * this first.
 */
export async function requireOwner(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/signin');
  if (!user.isOwner) notFound();
  return user;
}
