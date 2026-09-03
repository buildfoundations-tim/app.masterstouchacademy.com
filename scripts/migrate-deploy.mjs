/**
 * Apply committed migrations, as part of the build.
 *
 * Two reasons this exists rather than a bare `prisma migrate deploy` in the
 * build script:
 *
 *  1. **Migrations need a direct connection.** The pooled Neon endpoint does
 *     not support the session-level advisory locks migrate takes, so this
 *     swaps in the unpooled URL for the duration of the command. The running
 *     app keeps using the pooled one.
 *  2. **A schema change and the code that reads it must ship together.** Before
 *     this, migrations were run by hand from a developer's machine after the
 *     push; a deploy that landed first served pages reading columns that did
 *     not exist yet. Failing the build is the better failure: nothing ships.
 *
 * `migrate deploy` never generates a migration and never resets — it applies
 * what is committed, in order, and is a no-op when there is nothing pending.
 * Safe to re-run, which matters because a retried build runs it again.
 *
 * Outside Vercel this is a no-op: local schema changes go through
 * `npm run db:migrate`, and running a production deploy step against a dev
 * database on every `npm run build` would be surprising.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

if (!process.env.VERCEL) {
  console.log('[migrate] not on Vercel — skipping (use `npm run db:migrate` locally)');
  process.exit(0);
}

const direct =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DIRECT_DATABASE_URL;

if (!direct) {
  console.warn(
    '[migrate] no unpooled connection string (DATABASE_URL_UNPOOLED / ' +
      'POSTGRES_URL_NON_POOLING / DIRECT_DATABASE_URL); falling back to DATABASE_URL'
  );
}

const result = spawnSync(
  process.execPath,
  // Resolved rather than spawned as `npx prisma`: npx.cmd is unreliable on
  // Windows and adds a process for nothing.
  [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: direct ?? process.env.DATABASE_URL,
      // The shadow database is a local-development concept. Leaving a dev value
      // set here would send migrate at a machine that is not reachable.
      SHADOW_DATABASE_URL: '',
    },
  }
);

process.exit(result.status ?? 1);
