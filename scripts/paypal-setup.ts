/**
 * Creates the PayPal catalog product and the six subscription plans, then
 * prints the env lines to paste.
 *
 * Run once per environment (sandbox, then live) — plan ids differ between them.
 * Re-running creates DUPLICATE plans at PayPal, so it refuses if plan ids are
 * already configured unless you pass --force.
 *
 *   npm run paypal:setup
 */
import 'dotenv/config';

import { PLANS, centsToValue, planIdEnvName, paypalPlanId } from '../src/lib/billing';

const BASE =
  process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

const PRODUCT_ID = 'MTA-MEMBERSHIP';

async function token(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    console.error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in .env.');
    console.error('See docs/paypal-setup.md for where to get them.');
    process.exit(1);
  }

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    console.error(`PayPal auth failed (${res.status}). Check the credentials and PAYPAL_ENV.`);
    console.error(await res.text());
    process.exit(1);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api<T>(t: string, path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function main() {
  const force = process.argv.includes('--force');
  const alreadySet = PLANS.filter((p) => paypalPlanId(p.key));

  if (alreadySet.length > 0 && !force) {
    console.log(`${alreadySet.length} plan id(s) are already configured:\n`);
    for (const p of alreadySet) console.log(`  ${planIdEnvName(p.key)}=${paypalPlanId(p.key)}`);
    console.log('\nRe-running would create duplicate plans at PayPal.');
    console.log('Pass --force if you genuinely want a fresh set.');
    return;
  }

  const env = process.env.PAYPAL_ENV === 'live' ? 'LIVE' : 'SANDBOX';
  console.log(`Creating plans in PayPal ${env} (${BASE})\n`);

  const t = await token();

  // The product groups the plans in PayPal's dashboard. Fixed id so a re-run
  // reuses it rather than making another.
  let productId = PRODUCT_ID;
  try {
    const product = await api<{ id: string }>(t, '/v1/catalogs/products', {
      id: PRODUCT_ID,
      name: 'Masters Touch Academy membership',
      description: 'Certification and continuing education for restoration and cleaning professionals.',
      type: 'SERVICE',
      category: 'EDUCATIONAL_AND_TEXTBOOKS',
    });
    productId = product.id;
    console.log(`  product created: ${productId}`);
  } catch (e) {
    if (String(e).includes('DUPLICATE_RESOURCE_IDENTIFIER')) {
      console.log(`  product ${PRODUCT_ID} already exists — reusing it`);
    } else {
      throw e;
    }
  }

  const lines: string[] = [];

  for (const plan of PLANS) {
    const created = await api<{ id: string; status: string }>(t, '/v1/billing/plans', {
      product_id: productId,
      name: `${plan.label} — ${plan.interval === 'year' ? 'yearly' : 'monthly'}`,
      description: plan.blurb,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: {
            interval_unit: plan.interval === 'year' ? 'YEAR' : 'MONTH',
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: centsToValue(plan.chargeCents), currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CANCEL',
        payment_failure_threshold: 3,
      },
    });

    console.log(
      `  ${plan.key.padEnd(16)} $${centsToValue(plan.chargeCents).padStart(8)} / ${plan.interval}  ->  ${created.id} (${created.status})`
    );
    lines.push(`${planIdEnvName(plan.key)}=${created.id}`);
  }

  console.log('\n─────────────────────────────────────────────');
  console.log('Paste these into your .env (or Vercel env vars):\n');
  console.log(lines.join('\n'));
  console.log('─────────────────────────────────────────────');
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
