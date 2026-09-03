'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The persistent app bar: cart, notifications, and the account menu, plus the
 * menu button that opens the sidebar as a drawer on a phone.
 *
 * It is positioned over the right-hand end of whatever `.topbar` the current
 * page renders, so there is one 64px band rather than two stacked ones — the
 * page owns the title, the shell owns the actions. `.topbar` reserves the
 * space with padding; see globals.css.
 *
 * The drawer state is written to `document.body` rather than lifted into a
 * client shell wrapping the whole app. The alternative would push a client
 * boundary around every page in the app for one boolean.
 */

export type BarNotice = {
  id: string;
  title: string;
  body?: string;
  href: string;
  at: string;
  tone: 'info' | 'good' | 'warn';
  unread: boolean;
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'soon';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function AppBar({
  cartCount,
  notices,
  unreadCount,
  name,
  initials,
  tierLabel,
  markRead,
  signOut,
}: {
  cartCount: number;
  notices: BarNotice[];
  unreadCount: number;
  name: string;
  initials: string;
  tierLabel: string;
  markRead: () => Promise<void>;
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState<'none' | 'notices' | 'account'>('none');
  const [navOpen, setNavOpen] = useState(false);
  // Optimistic: the badge clears the moment the list is opened, before the
  // server action round-trips. Re-opening a list you have already read should
  // not flash a stale count back at you.
  const [seen, setSeen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Navigating is an implicit dismissal of everything.
  useEffect(() => {
    setOpen('none');
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.toggleAttribute('data-nav-open', navOpen);
  }, [navOpen]);

  useEffect(() => {
    if (open === 'none') return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen('none');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen('none');
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleNotices = () => {
    const next = open === 'notices' ? 'none' : 'notices';
    setOpen(next);
    if (next === 'notices' && unreadCount > 0 && !seen) {
      setSeen(true);
      void markRead();
    }
  };

  const badge = seen ? 0 : unreadCount;

  return (
    <>
      <button
        type="button"
        className="navtoggle"
        aria-label={navOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={navOpen}
        onClick={() => setNavOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="17" height="17">
          {navOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {navOpen ? (
        <div className="navscrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      ) : null}

      <div className="appbar" ref={barRef}>
        <Link
          href="/cart"
          className="appbar__btn"
          aria-label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 9l1.5-5h15L21 9" />
            <path d="M3 9h18v11H3z" />
            <path d="M9 13a3 3 0 006 0" />
          </svg>
          {cartCount > 0 ? <span className="appbar__badge">{cartCount}</span> : null}
        </Link>

        <div className="appbar__slot">
          <button
            type="button"
            className="appbar__btn"
            aria-label={badge > 0 ? `Notifications, ${badge} unread` : 'Notifications'}
            aria-expanded={open === 'notices'}
            onClick={toggleNotices}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {badge > 0 ? <span className="appbar__badge appbar__badge--alert">{badge}</span> : null}
          </button>

          {open === 'notices' ? (
            <div className="popover" role="dialog" aria-label="Notifications">
              <div className="popover__head">Notifications</div>
              {notices.length === 0 ? (
                <p className="popover__empty">
                  Nothing needs you right now. Class reminders and receipts land here.
                </p>
              ) : (
                notices.map((n) => (
                  <Link key={n.id} href={n.href} className="notice">
                    <span
                      className={`notice__dot notice__dot--${n.tone}`}
                      data-unread={n.unread ? '' : undefined}
                      aria-hidden="true"
                    />
                    <span className="notice__text">
                      <span className="notice__title">{n.title}</span>
                      {n.body ? <span className="notice__body">{n.body}</span> : null}
                      <span className="notice__time">{ago(n.at)}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className="appbar__slot">
          <button
            type="button"
            className="appbar__account"
            aria-label="Your account"
            aria-expanded={open === 'account'}
            onClick={() => setOpen(open === 'account' ? 'none' : 'account')}
          >
            <span className="avatar">{initials}</span>
          </button>

          {open === 'account' ? (
            <div className="popover popover--menu" role="menu" aria-label="Your account">
              <div className="popover__who">
                <strong>{name}</strong>
                <span className="faint">{tierLabel}</span>
              </div>
              <Link href="/membership" className="popover__item" role="menuitem">
                Membership
              </Link>
              <Link href="/orders" className="popover__item" role="menuitem">
                Orders
              </Link>
              <Link href="/certificates" className="popover__item" role="menuitem">
                Certificates
              </Link>
              <form action={signOut}>
                <button type="submit" className="popover__item popover__item--danger" role="menuitem">
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
