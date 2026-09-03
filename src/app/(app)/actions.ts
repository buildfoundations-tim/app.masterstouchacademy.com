'use server';

import { redirect } from 'next/navigation';

import { destroySession, getSessionUser } from '@/lib/auth';
import { markNoticesRead } from '@/lib/notifications';

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/signin');
}

/**
 * Clear the notification badge.
 *
 * Fired when the bell's list is opened. No revalidate: the badge is already
 * cleared optimistically in the client, and forcing a re-render of the page
 * under an open popover would close it.
 */
export async function markNotificationsRead(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await markNoticesRead(user.id);
}
