import 'server-only';

/**
 * PayPal REST client.
 *
 * Endpoints and event names verified against developer.paypal.com rather than
 * recalled: OAuth is POST /v1/oauth2/token with Basic auth and
 * grant_type=client_credentials; subscriptions live under /v1/billing; webhook
 * signatures are checked by POSTing the transmission headers plus the raw event
 * to /v1/notifications/verify-webhook-signature.
 *
 * Nothing here is called from the browser. The client id is public by nature,
 * but the secret must never reach a client component.
 */

const LIVE = 'https://api-m.paypal.com';
const SANDBOX = 'https://api-m.sandbox.paypal.com';

export type PayPalEnv = 'sandbox' | 'live';

export function paypalEnv(): PayPalEnv {
  return process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
}

export function paypalBase(): string {
  return paypalEnv() === 'live' ? LIVE : SANDBOX;
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function credentials(): { id: string; secret: string } {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set. Copy them from the ' +
        'PayPal developer dashboard into .env — see docs/paypal-setup.md.'
    );
  }
  return { id, secret };
}

// Access tokens last ~8 hours. Cache in module scope and refresh a minute early
// rather than fetching a new one per call.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const { id, secret } = credentials();
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = 'PayPalError';
  }
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const token = await accessToken();

  const res = await fetch(`${paypalBase()}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : res.statusText;
    throw new PayPalError(`PayPal ${init.method ?? 'GET'} ${path} failed: ${detail}`, res.status, parsed);
  }

  return parsed as T;
}

// ── Catalog products and plans ───────────────────────────────

export type PayPalLink = { href: string; rel: string; method?: string };

export async function createProduct(input: {
  name: string;
  description: string;
  id?: string;
}): Promise<{ id: string }> {
  return call('/v1/catalogs/products', {
    method: 'POST',
    body: {
      id: input.id,
      name: input.name,
      description: input.description,
      type: 'SERVICE',
      category: 'EDUCATIONAL_AND_TEXTBOOKS',
    },
  });
}

export async function createPlan(input: {
  productId: string;
  name: string;
  description: string;
  /** 'MONTH' bills monthly; 'YEAR' bills once a year. */
  intervalUnit: 'MONTH' | 'YEAR';
  /** Amount charged per cycle, in dollars as a string, e.g. "69.00". */
  value: string;
}): Promise<{ id: string; status: string }> {
  return call('/v1/billing/plans', {
    method: 'POST',
    body: {
      product_id: input.productId,
      name: input.name,
      description: input.description,
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: input.intervalUnit, interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          // 0 = bill forever until cancelled.
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: input.value, currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CANCEL',
        payment_failure_threshold: 3,
      },
    },
  });
}

export async function listPlans(): Promise<{ plans: Array<{ id: string; name: string; status: string }> }> {
  return call('/v1/billing/plans?page_size=20&total_required=true');
}

// ── Subscriptions ────────────────────────────────────────────

export type PayPalSubscription = {
  id: string;
  plan_id: string;
  status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
  start_time?: string;
  custom_id?: string;
  billing_info?: { next_billing_time?: string };
  links?: PayPalLink[];
};

export async function createSubscription(input: {
  planId: string;
  /** Our user id — comes back on every webhook, which is how we map to a member. */
  customId: string;
  returnUrl: string;
  cancelUrl: string;
  subscriberEmail?: string;
  subscriberName?: { given_name: string; surname: string };
}): Promise<PayPalSubscription> {
  return call('/v1/billing/subscriptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      plan_id: input.planId,
      custom_id: input.customId,
      subscriber: {
        email_address: input.subscriberEmail,
        name: input.subscriberName,
      },
      application_context: {
        brand_name: 'Masters Touch Academy',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        payment_method: {
          payer_selected: 'PAYPAL',
          payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
        },
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    },
  });
}

export async function getSubscription(id: string): Promise<PayPalSubscription> {
  return call(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

export async function cancelSubscription(id: string, reason: string): Promise<void> {
  await call(`/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { reason: reason.slice(0, 127) },
  });
}

/** The URL to send the member to so they can approve the subscription. */
export function approvalUrl(sub: PayPalSubscription): string | null {
  return sub.links?.find((l) => l.rel === 'approve')?.href ?? null;
}

// ── Webhook verification ─────────────────────────────────────

export type WebhookHeaders = {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
};

/** Pull the five transmission headers PayPal sends. Missing any = not verifiable. */
export function readWebhookHeaders(h: Headers): WebhookHeaders | null {
  const transmissionId = h.get('paypal-transmission-id');
  const transmissionTime = h.get('paypal-transmission-time');
  const transmissionSig = h.get('paypal-transmission-sig');
  const certUrl = h.get('paypal-cert-url');
  const authAlgo = h.get('paypal-auth-algo');

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    return null;
  }
  return { transmissionId, transmissionTime, transmissionSig, certUrl, authAlgo };
}

/**
 * Ask PayPal whether a delivery is genuine.
 *
 * `event` must be the PARSED body of the exact bytes received — re-serialising
 * a mutated object changes the signature basis and the check will fail.
 *
 * Returns false rather than throwing on a network error: an unverifiable
 * delivery must never be treated as verified.
 */
export async function verifyWebhook(input: {
  headers: WebhookHeaders;
  event: unknown;
}): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID is not set — cannot verify webhook deliveries.');
  }

  try {
    const res = await call<{ verification_status: string }>(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: {
          auth_algo: input.headers.authAlgo,
          cert_url: input.headers.certUrl,
          transmission_id: input.headers.transmissionId,
          transmission_sig: input.headers.transmissionSig,
          transmission_time: input.headers.transmissionTime,
          webhook_id: webhookId,
          webhook_event: input.event,
        },
      }
    );
    return res.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}
