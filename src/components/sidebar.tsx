'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import type { UserRole } from '@/generated/prisma/enums';

/**
 * Left navigation. Client-side only so the active item can be derived from the
 * pathname. Identity and sign-out live in the app bar's account menu, not
 * here — one home for the account, as the prototype has it.
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
    href: '/orders',
    label: 'Orders',
    icon: icon(
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5" />
        <path d="M9 13h7M9 17h5" />
      </>
    ),
  },
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

export function Sidebar({ role }: { role: UserRole }) {
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

        {/* The cart moved to the app bar, where it sits beside notifications
            and the account menu — as in the prototype. It is not duplicated
            here: two live counts for one cart is one too many places to be
            wrong. */}
        <div className="sidebar__group">Account</div>
        {ACCOUNT.map(renderLink)}

        {/* The instructor portal is not built yet. The link lived here before
            the page did and 404'd — a nav entry is a promise, so it stays out
            until /instructor exists. See docs/roadmap.md, phase 5. */}

        {role === 'owner' ? (
          <>
            <div className="sidebar__group">Admin</div>
            {renderLink({
              href: '/admin/members',
              label: 'Members',
              icon: icon(
                <>
                  <circle cx="9" cy="8" r="3.4" />
                  <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
                  <path d="M16 11a3 3 0 100-6" />
                  <path d="M18 20c0-2.4-1-4.2-2.6-5.2" />
                </>
              ),
            })}
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
            {renderLink({
              href: '/admin/courses',
              label: 'Courses',
              icon: icon(
                <>
                  <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z" />
                  <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z" />
                </>
              ),
            })}
            {renderLink({
              href: '/admin/attendance',
              label: 'Attendance',
              icon: icon(
                <>
                  <path d="M4 5h16v16H4z" />
                  <path d="M8 3v4M16 3v4" />
                  <path d="M8.5 14l2.2 2.2L16 11" />
                </>
              ),
            })}
            {renderLink({
              href: '/admin/orders',
              label: 'Orders',
              icon: icon(
                <>
                  <path d="M3 6h18M3 12h18M3 18h13" />
                </>
              ),
            })}

          </>
        ) : null}
      </nav>
    </aside>
  );
}
