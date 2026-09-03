import { notFound } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';

/**
 * Owner gate for every /admin route.
 *
 * Mirrors the (app) layout pattern: the check lives here so a new admin page is
 * gated by default. 404 rather than 403 — a non-owner has no business learning
 * that an admin area exists at this path.
 *
 * Server actions under /admin must still re-check isOwner themselves; a layout
 * does not run for a direct action POST.
 */
export default async function AdminLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser();
  if (user?.role !== 'owner') notFound();

  return <>{children}</>;
}
