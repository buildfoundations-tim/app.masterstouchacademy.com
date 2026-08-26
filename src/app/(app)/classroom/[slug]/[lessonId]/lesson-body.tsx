import type { LessonType } from '@/generated/prisma/enums';

/**
 * Renders one lesson by type.
 *
 * Video is a placeholder on purpose. Per vimeo-integration.md the real player
 * must not receive a file URL — the client asks GET /api/video/:assetKey, the
 * server checks entitlement and returns only { videoId, hash, expiresAt }, and
 * the Vimeo iframe is mounted from that. Until the Vimeo account and asset-key
 * mapping exist, showing the asset key is honest; a fake <video> tag would
 * invite someone to wire it up the wrong way.
 */
export function LessonBody({
  type,
  title,
  body,
  assetKey,
  resourceUrl,
  duration,
}: {
  type: LessonType;
  title: string;
  body: string | null;
  assetKey: string | null;
  resourceUrl: string | null;
  duration: string;
}) {
  if (type === 'video') {
    return (
      <div className="player">
        <div className="player__frame">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16" />
          </svg>
          <p>Video player</p>
          <p className="player__note">
            Not wired up yet. The server will resolve <code>{assetKey ?? '—'}</code> to a Vimeo id
            after an entitlement check — the file URL never reaches the browser.
          </p>
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>
          {duration ? `${duration} · ` : ''}asset key <code>{assetKey ?? 'unset'}</code>
        </p>
      </div>
    );
  }

  if (type === 'resource') {
    return (
      <div className="card" style={{ padding: 22 }}>
        <h2 className="display" style={{ fontSize: 22, marginBottom: 8 }}>
          {title}
        </h2>
        {resourceUrl ? (
          <a className="btn btn--outline btn--sm" href={resourceUrl} target="_blank" rel="noopener noreferrer">
            Open resource
          </a>
        ) : (
          <p className="muted">No file attached to this resource yet.</p>
        )}
      </div>
    );
  }

  // text (and quiz lessons until the inline quiz UI lands)
  return (
    <article className="card lesson-text">
      <h2 className="display" style={{ fontSize: 24, marginBottom: 14 }}>
        {title}
      </h2>
      {body ? (
        body.split('\n\n').map((para, i) => <p key={i}>{para}</p>)
      ) : (
        <p className="muted">This lesson has no content yet.</p>
      )}
    </article>
  );
}
