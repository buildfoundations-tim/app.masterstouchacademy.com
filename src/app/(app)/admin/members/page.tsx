import Link from 'next/link';

import { listMembers, memberTotals } from '@/lib/members';
import { TIER_LABEL } from '@/lib/access';
import { formatDate } from '@/lib/format';

export const metadata = { title: 'Admin · Members' };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** "Today", "5h ago", "6d ago" — the prototype's Active column. */
function lastSeen(at: Date | null): string {
  if (!at) return 'never';
  const ms = Date.now() - at.getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return formatDate(at);
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tier?: string }>;
}) {
  const { q, tier } = await searchParams;
  const tierFilter = tier ? Number(tier) : undefined;

  const [members, totals] = await Promise.all([
    listMembers({ search: q, tier: Number.isFinite(tierFilter) ? tierFilter : undefined }),
    memberTotals(),
  ]);

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">Members</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {totals.total} total · {totals.paying} paying
        </span>
      </header>

      <div className="page">
        <div className="stat-row">
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.total}</span>
            <span className="stat-tile__label">Members</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.paying}</span>
            <span className="stat-tile__label">On a paid tier</span>
          </div>
          <div className="card stat-tile">
            <span className={`stat-tile__value${totals.unverified > 0 ? ' is-bad' : ''}`}>
              {totals.unverified}
            </span>
            <span className="stat-tile__label">Email unconfirmed</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-tile__value">{totals.overridden}</span>
            <span className="stat-tile__label">Tier set by hand</span>
          </div>
        </div>

        <form method="get" className="admin-search">
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search by name, email, or company"
          />
          <select className="input" name="tier" defaultValue={tier ?? ''} style={{ maxWidth: 170 }}>
            <option value="">Every tier</option>
            {[1, 2, 3, 4].map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]} ({totals.perTier[t] ?? 0})
              </option>
            ))}
          </select>
          <button className="btn btn--outline btn--sm" type="submit">
            Search
          </button>
          {q || tier ? (
            <Link className="btn btn--outline btn--sm" href="/admin/members">
              Clear
            </Link>
          ) : null}
        </form>

        {members.length === 0 ? (
          <div className="card" style={{ padding: 30, textAlign: 'center' }}>
            <p className="muted">
              {q || tier ? 'Nobody matches that.' : 'No members yet.'}
            </p>
          </div>
        ) : (
          <div className="card table-wrap">
            <div className="mtable">
              <div className="mtable__head">
                <span>Member</span>
                <span>Company</span>
                <span>Plan</span>
                <span>Joined</span>
                <span>Courses</span>
                <span>Active</span>
              </div>

              {members.map((m) => (
                <Link key={m.id} href={`/admin/members/${m.id}`} className="mtable__row">
                  <span className="mtable__who">
                    <span className="avatar avatar--light">{initials(m.name)}</span>
                    <span className="mtable__name">
                      {m.name}
                      <span className="faint mtable__email">{m.email}</span>
                    </span>
                  </span>
                  <span className="muted mtable__trunc">{m.company ?? '—'}</span>
                  <span>
                    <span
                      className={`badge${m.isStaff || m.tier >= 2 ? ' badge--done' : ' badge--locked'}`}
                    >
                      {m.label}
                    </span>
                    {/* Flagged in the list, not just on the detail page: a tier
                        that was given rather than bought is the thing an owner
                        most needs to notice while scanning. */}
                    {m.overridden ? <span className="faint mtable__flag">by hand</span> : null}
                  </span>
                  <span className="muted">{formatDate(m.joinedAt)}</span>
                  <span className="muted">{m.courseCount}</span>
                  <span className="faint">{lastSeen(m.lastSeenAt)}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
