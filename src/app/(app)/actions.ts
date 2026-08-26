'use server';

import { redirect } from 'next/navigation';

import { destroySession } from '@/lib/auth';

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/signin');
}
