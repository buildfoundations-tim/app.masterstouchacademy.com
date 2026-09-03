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

  const mail = {
    transport: process.env.MAIL_TRANSPORT || 'console',
    // console logs instead of sending, so nobody would receive anything.
    willActuallySend: (process.env.MAIL_TRANSPORT || 'console') !== 'console',
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
  };

  const ready = database.status === 'ok' && app.authSecretSet;

  return NextResponse.json(
    { ready, database, paypal, mail, app, platform },
    { status: ready ? 200 : 503 }
  );
}
