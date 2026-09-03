import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { TIER_LABEL } from '@/lib/access';
import { Sidebar } from '@/components/sidebar';
import { cartCount } from '@/lib/cart';
import { noticesFor } from '@/lib/notifications';
import { AppBar } from '@/components/app-bar';
import { signOut, markNotificationsRead } from './actions';

/**
 * Every route under (app) is behind this gate. Doing it in the layout means a
 * new page cannot accidentally ship unauthenticated — it has to opt out rather
 * than opt in.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const [itemsInCart, notices] = await Promise.all([
    cartCount(user.id),
    noticesFor(user),
  ]);

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="shell">
      <Sidebar isOwner={user.isOwner} isInstructor={user.isInstructor} />

      <AppBar
        cartCount={itemsInCart}
        // Dates do not survive the boundary into a client component; ISO does.
        notices={notices.map((n) => ({ ...n, at: n.at.toISOString() }))}
        unreadCount={notices.filter((n) => n.unread).length}
        name={user.displayName || `${user.firstName} ${user.lastName}`}
        initials={initials}
        tierLabel={TIER_LABEL[user.tier]}
        markRead={markNotificationsRead}
        signOut={signOut}
      />

      <div className="main">{children}</div>
    </div>
  );
}
