'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Left navigation. Client-side only so the active item can be derived from the
 * pathname; the account block is passed in from the server layout so no user
 * data has to cross into a client component.
 */

type Item = { href: string; label: string; icon: ReactNode };

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);

const MAIN: Item[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: icon(
      <>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v10h14V10" />
      </>
    ),
  },
  {
    href: '/classroom',
    label: 'Classroom',
    icon: icon(
      <>
        <path d="M4 5h7v14H4z" />
        <path d="M13 5h7v14h-7z" />
      </>
    ),
  },
  {
    href: '/schedule',
    label: 'Class schedule',
    icon: icon(
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    href: '/certificates',
    label: 'Certificates',
    icon: icon(
      <>
        <circle cx="12" cy="9" r="5.5" />
        <path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" />
      </>
    ),
  },
];

const ACCOUNT: Item[] = [
  {
    href: '/membership',
    label: 'Membership',
    icon: icon(
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </>
    ),
  },
];

export function Sidebar({
  isOwner,
  isInstructor,
  cartCount = 0,
  children,
}: {
  isOwner: boolean;
  isInstructor: boolean;
  cartCount?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const renderLink = (item: Item) => (
    <Link
      key={item.href}
      href={item.href}
      className="navlink"
      aria-current={isActive(item.href) ? 'page' : undefined}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-academy-light-full.png" alt="Masters Touch Academy" width={216} height={39} />
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {MAIN.map(renderLink)}

        <div className="sidebar__group">Account</div>
        <Link
          href="/cart"
          className="navlink"
          aria-current={isActive('/cart') ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="20" r="1.4" />
            <circle cx="18" cy="20" r="1.4" />
            <path d="M2 3h3l2.4 12.2a1.6 1.6 0 001.6 1.3h8.4a1.6 1.6 0 001.6-1.3L21 7H6" />
          </svg>
          <span>Cart</span>
          {cartCount > 0 ? <span className="navlink__badge">{cartCount}</span> : null}
        </Link>
        {ACCOUNT.map(renderLink)}

        {/* The instructor portal is not built yet. The link lived here before
            the page did and 404'd — a nav entry is a promise, so it stays out
            until /instructor exists. See docs/roadmap.md, phase 5. */}

        {isOwner ? (
          <>
            <div className="sidebar__group">Admin</div>
            {renderLink({
              href: '/admin/classes',
              label: 'Classes',
              icon: icon(
                <>
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18" />
                </>
              ),
            })}
            {/* Admin → Members is phase 2; the link 404'd until then. */}
          </>
        ) : null}
      </nav>

      {children}
    </aside>
  );
}
