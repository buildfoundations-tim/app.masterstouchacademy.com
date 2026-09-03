/**
 * Push this project's environment variables to Vercel Production.
 *
 * Written because doing it by hand through the dashboard produced sixteen
 * variables whose names existed but whose values were empty — the classic
 * result of bulk-pasting KEY="value" lines, where the quotes get taken as part
 * of the value or the value is dropped entirely.
 *
 * Values are read from your local .env and piped straight to the Vercel CLI.
 * They are never printed; this script only ever echoes variable NAMES.
 *
 * Prerequisites, run once each:
 *     node node_modules/vercel/dist/index.js login
 *     node node_modules/vercel/dist/index.js link   (pick app-masterstouchacademy-com-43ch)
 *
 * Those avoid npx.cmd, which PowerShell's execution policy blocks.
 *
 * Then:
 *     node scripts/push-env-to-vercel.mjs "<POOLED NEON CONNECTION STRING>"
 *
 * The Neon string is required as an argument because the DATABASE_URL in your
 * local .env points at the Postgres on your own machine, which Vercel cannot
 * reach.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const databaseUrl = process.argv[2];

if (!databaseUrl) {
  console.error('Missing the Neon connection string.\n');
  console.error('Usage:');
  console.error('  node scripts/push-env-to-vercel.mjs "postgresql://...-pooler...neon.tech/neondb?sslmode=require"\n');
  console.error('Get it from the Neon dashboard → Connection string → Pooled.');
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
  console.error('That does not look like a Postgres connection string.');
  process.exit(1);
}
// Reject the example string from the docs. Setting it would "succeed" and
// leave production pointing at a host that does not exist.
if (/PASSWORD@|ep-xxxx|<.*>/.test(databaseUrl)) {
  console.error('That is the placeholder from the instructions, not your real connection string.');
  console.error('Get the real one: Neon dashboard → your project → Connection string → Pooled.');
  console.error('It contains your actual password and a real endpoint id.');
  process.exit(1);
}

if (!databaseUrl.includes('-pooler')) {
  console.warn('WARNING: that string has no "-pooler" in the host.');
  console.warn('Serverless functions need the POOLED endpoint or they will exhaust connections.');
  console.warn('Continuing anyway in 3 seconds — Ctrl+C to stop.\n');
  execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},3000)'], { stdio: 'ignore' });
}

// ── Read the local .env ──────────────────────────────────────
const local = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  // Strip surrounding quotes — this is exactly what the dashboard paste got wrong.
  local[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// ── What production should hold ──────────────────────────────
const values = {
  DATABASE_URL: databaseUrl,
  APP_URL: 'https://app.masterstouchacademy.com',
  AUTH_SECRET: randomBytes(32).toString('base64'),
  MAIL_TRANSPORT: 'smtp',

  PAYPAL_ENV: local.PAYPAL_ENV,
  PAYPAL_CLIENT_ID: local.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: local.PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID: local.PAYPAL_WEBHOOK_ID,
  PAYPAL_PLAN_PRO_MONTHLY: local.PAYPAL_PLAN_PRO_MONTHLY,
  PAYPAL_PLAN_PRO_YEARLY: local.PAYPAL_PLAN_PRO_YEARLY,
  PAYPAL_PLAN_PROPLUS_MONTHLY: local.PAYPAL_PLAN_PROPLUS_MONTHLY,
  PAYPAL_PLAN_PROPLUS_YEARLY: local.PAYPAL_PLAN_PROPLUS_YEARLY,
  PAYPAL_PLAN_CREW_MONTHLY: local.PAYPAL_PLAN_CREW_MONTHLY,
  PAYPAL_PLAN_CREW_YEARLY: local.PAYPAL_PLAN_CREW_YEARLY,
  MAIL_FROM: local.MAIL_FROM,
};

// SHADOW_DATABASE_URL is deliberately absent: it is only used by local
// migrations and would be meaningless (and wrong) in production.

const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`These have no value in your local .env: ${missing.join(', ')}`);
  console.error('Fill them in locally first, or remove them from this script.');
  process.exit(1);
}

// ── Push ─────────────────────────────────────────────────────
// Invoke the Vercel CLI's JavaScript entry point with node directly.
//
// The obvious `npx vercel …` does not work here: Node 20+ refuses to spawn
// .cmd/.bat files (CVE-2024-27980), which surfaces as "spawnSync npx.cmd
// EINVAL", and the usual workaround — shell:true — concatenates arguments
// without escaping them. Going straight to the .js file avoids the shell, the
// .cmd wrapper, and PowerShell's execution policy in one move.
const vercelCli = createRequire(import.meta.url).resolve('vercel/dist/index.js');

function run(args, input) {
  return execFileSync(process.execPath, [vercelCli, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

console.log(`Pushing ${Object.keys(values).length} variables to Vercel Production.\n`);

let ok = 0;
let failed = 0;

for (const [name, value] of Object.entries(values)) {
  process.stdout.write(`  ${name.padEnd(30)}`);

  // Remove any existing value first — `vercel env add` will not overwrite,
  // and a stale empty entry is exactly what we are here to fix.
  try {
    run(['env', 'rm', name, 'production', '--yes']);
  } catch {
    // Not present yet. Fine.
  }

  try {
    run(['env', 'add', name, 'production'], value);
    console.log('ok');
    ok++;
  } catch (e) {
    const detail = String(e.stderr || e.message || '').split('\n').find(Boolean) || 'failed';
    console.log(`FAILED — ${detail.slice(0, 80)}`);
    failed++;
  }
}

console.log(`\n${ok} set, ${failed} failed.`);

if (failed === 0) {
  console.log('\nNow redeploy so the new values are picked up:');
  console.log('  node node_modules/vercel/dist/index.js --prod');
  console.log('\nThen check:');
  console.log('  curl https://app.masterstouchacademy.com/api/health');
} else {
  console.log('\nIf everything failed, you are probably not logged in or linked:');
  console.log('  node node_modules/vercel/dist/index.js login');
  console.log('  node node_modules/vercel/dist/index.js link');
}

console.log('\nNote: a fresh AUTH_SECRET was generated. Any existing sessions will be invalid.');
