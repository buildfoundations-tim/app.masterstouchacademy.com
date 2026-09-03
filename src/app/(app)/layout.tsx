import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/auth';
import { TIER_LABEL } from '@/lib/access';
import { Sidebar } from '@/components/sidebar';
import { cartCount } from '@/lib/cart';
import { signOut } from './actions';

/**
 * Every route under (app) is behind this gate. Doing it in the layout means a
 * new page cannot accidentally ship unauthenticated — it has to opt out rather
 * than opt in.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getSessionUser();
  if (!user) redirect('/signin');

  const itemsInCart = await cartCount(user.id);

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="shell">
      <Sidebar isOwner={user.isOwner} isInstructor={user.isInstructor} cartCount={itemsInCart}>
        <div className="sidebar__account">
          <span className="avatar">{initials}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.displayName || `${user.firstName} ${user.lastName}`}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fainter)' }}>{TIER_LABEL[user.tier]}</div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              style={{ background: 'none', border: 0, color: 'var(--fainter)', padding: 4, lineHeight: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </Sidebar>

      <div className="main">{children}</div>
    </div>
  );
}
