import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

/**
 * Deployment health check.
 *
 * Exists because a production 500 is deliberately opaque — the error page shows
 * nothing, which is right for visitors and useless for diagnosis. This reports
 * whether each dependency is wired, and distinguishes the failures that look
 * identical from outside: no DATABASE_URL, unreachable database, and a reachable
 * database with no tables yet.
 *
 * It reports only presence and reachability. **No secret, connection string,
 * host, or credential is ever included** — a value must never appear here.
 */

export const dynamic = 'force-dynamic';

type DbStatus =
  | 'ok'
  | 'not-configured'
  | 'no-tables'
  | 'unreachable'
  | 'error';

async function checkDatabase(): Promise<{ status: DbStatus; detail?: string }> {
  if (!process.env.DATABASE_URL) {
    return { status: 'not-configured', detail: 'DATABASE_URL is not set on this deployment' };
  }

  try {
    // Touching a real table proves both connectivity and that migrations ran.
    const courses = await db.course.count();
    return { status: 'ok', detail: `${courses} courses in the catalog` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // P2021 = table does not exist: connected fine, migrations never ran.
    if (message.includes('P2021') || /does not exist/i.test(message)) {
      return { status: 'no-tables', detail: 'connected, but the schema is missing — run prisma migrate deploy' };
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) {
      return { status: 'unreachable', detail: 'DATABASE_URL is set but the database did not answer' };
    }
    // Deliberately not echoing the message — it can contain the host.
    return { status: 'error', detail: 'connection failed for an unexpected reason' };
  }
}

export async function GET() {
  const database = await checkDatabase();

  const paypal = {
    configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    webhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    plansConfigured: [
      'PAYPAL_PLAN_PRO_MONTHLY', 'PAYPAL_PLAN_PRO_YEARLY',
      'PAYPAL_PLAN_PROPLUS_MONTHLY', 'PAYPAL_PLAN_PROPLUS_YEARLY',
      'PAYPAL_PLAN_CREW_MONTHLY', 'PAYPAL_PLAN_CREW_YEARLY',
    ].filter((k) => Boolean(process.env[k])).length,
  };

  const transport = process.env.MAIL_TRANSPORT || 'console';

  // "willActuallySend" was not enough: a transport of smtp with no password
  // still fails, just later and less visibly — at authentication, after the
  // member has already submitted the form. Report whether the transport is
  // fully configured, not merely selected.
  const smtpComplete = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD
  );

  const mail = {
    transport,
    willActuallySend: transport !== 'console',
    configured:
      transport === 'smtp'
        ? smtpComplete
        : transport === 'resend'
          ? Boolean(process.env.RESEND_API_KEY)
          : true,
    smtp:
      transport === 'smtp'
        ? {
            hostSet: Boolean(process.env.SMTP_HOST),
            portSet: Boolean(process.env.SMTP_PORT),
            userSet: Boolean(process.env.SMTP_USER),
            passwordSet: Boolean(process.env.SMTP_PASSWORD),
            // 587 wants STARTTLS (secure=false); 465 wants implicit TLS.
            port: process.env.SMTP_PORT ?? '587 (default)',
            secure: process.env.SMTP_SECURE === 'true',
          }
        : undefined,
    fromSet: Boolean(process.env.MAIL_FROM),
  };

  const app = {
    appUrlSet: Boolean(process.env.APP_URL),
    authSecretSet: Boolean(process.env.AUTH_SECRET),
  };

  // Vercel injects these itself. If they are present but ours are not, the
  // variables are on a different project or scope — not simply unset. The
  // commit sha also identifies exactly which build is answering, which is the
  // only reliable way to tell a redeploy actually took effect.
  const platform = {
    onVercel: Boolean(process.env.VERCEL),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    // A count, never the names or values — enough to distinguish "no
    // environment at all" from "our variables specifically are missing".
    totalEnvVars: Object.keys(process.env).length,
    // Which recognised names are actually present. An allowlist of NAMES only —
    // no value is ever read. Integrations often inject their own naming
    // (Neon/Vercel Postgres use POSTGRES_*), which looks identical to "nothing
    // is set" unless you go looking for it.
    present: [
      'DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
      'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NO_SSL', 'PGHOST', 'PGDATABASE',
      'NEON_DATABASE_URL', 'AUTH_SECRET', 'APP_URL', 'PAYPAL_ENV', 'PAYPAL_CLIENT_ID',
      'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'MAIL_TRANSPORT', 'MAIL_FROM',
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE',
      'RESEND_API_KEY',
    ].filter((k) => Boolean(process.env[k])),
    // Any custom (non-system) names, so a typo or unexpected prefix shows up.
    customLike: Object.keys(process.env)
      .filter((k) => /^(DATABASE|POSTGRES|PG|NEON|PAYPAL|MAIL|SMTP|APP|AUTH|RESEND)/.test(k))
      .sort(),
  };

  // ready means a member could actually complete signup: the database answers,
  // sessions can be signed, and a verification email would genuinely be sent.
  const ready = database.status === 'ok' && app.authSecretSet && mail.configured;

  return NextResponse.json(
    { ready, database, paypal, mail, app, platform },
    { status: ready ? 200 : 503 }
  );
}
