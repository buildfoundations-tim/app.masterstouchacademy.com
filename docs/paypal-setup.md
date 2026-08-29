# PayPal setup

What you need to do in PayPal, and what to paste where. Do the whole thing in
**sandbox** first — nothing here touches real money until you switch `PAYPAL_ENV`
to `live` with a separate set of credentials.

## 0. You need a Business account

Subscriptions are Business-only. A Personal account can receive one-off
payments, but the Subscriptions API — billing plans, recurring charges,
subscription webhooks — is not available to it.

Upgrading Personal → Business is free, keeps the same email address and balance,
and takes a few minutes: **paypal.com → Settings → Account type → Upgrade to a
Business account**. You'll be asked for a business name (a sole trader can use
their own name) and a category.

You do **not** need a business bank account or a registered company to upgrade.

## 1. Create the REST app

1. Sign in at <https://developer.paypal.com/dashboard/>.
2. **Apps & Credentials** → make sure the **Sandbox** toggle is on.
3. **Create App** → name it `Masters Touch Academy` → type **Merchant**.
4. Copy the **Client ID** and **Secret**.

Put them in `.env` (never commit this file):

```
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

## 2. Create the subscription plans

```bash
npm run paypal:setup
```

This creates one catalog product and six plans (Pro, Pro+, Crew Leader — each
monthly and yearly) at the prices the marketing site advertises, then prints the
env lines to paste:

```
PAYPAL_PLAN_PRO_MONTHLY=P-...
PAYPAL_PLAN_PRO_YEARLY=P-...
...
```

Paste all six into `.env`.

**Run this once per environment.** Sandbox and live have completely different
plan ids. Re-running creates duplicate plans at PayPal, so the script refuses if
ids are already configured unless you pass `--force`.

To change a price later, do **not** edit a live plan's price — PayPal treats
pricing changes on an active plan carefully and existing subscribers keep their
original terms. Create a new plan and point the env var at it.

## 3. Create the webhook

The webhook is how a payment becomes a membership. Without it, a member can pay
and never be upgraded.

1. Developer dashboard → your app → **Webhooks** → **Add Webhook**.
2. URL: `https://app.masterstouchacademy.com/api/paypal/webhook`
   (see below for local testing)
3. Subscribe to these events:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.UPDATED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`
4. Save, then copy the **Webhook ID** it shows.

```
PAYPAL_WEBHOOK_ID=...
```

Every delivery is verified against this id by posting it back to PayPal's
`/v1/notifications/verify-webhook-signature`. **An unverified delivery is
discarded** — the endpoint is public and anyone can POST to it. If
`PAYPAL_WEBHOOK_ID` is missing, verification throws rather than passing.

### Testing webhooks locally

PayPal cannot reach `localhost`. Either:

- Use the dashboard's **Webhooks Simulator** (Developer dashboard → Webhooks
  Simulator) to fire a sample event at a public URL, or
- Expose your dev server with a tunnel (`cloudflared tunnel --url
  http://localhost:3000` or ngrok) and register that URL as a second sandbox
  webhook.

Note that simulator events carry a signature for a *sample* payload — they
verify, but they reference subscription ids that do not exist in your database,
so the handler will record `unknown-subscription` and stop. That is correct
behaviour, not a failure.

## 4. Sandbox buyer account

To actually click through a checkout you need a fake buyer:

Developer dashboard → **Testing Tools → Sandbox Accounts**. PayPal creates a
`personal` account by default — note its email and password. Use those at the
PayPal login during checkout. It has fake money.

## 5. Going live

1. Flip the dashboard toggle to **Live**, create a Live app, copy the new
   credentials.
2. Set `PAYPAL_ENV=live` and the live client id/secret.
3. Run `npm run paypal:setup` again — this creates the plans in live and prints
   a **new** set of plan ids. Replace all six.
4. Create a **live** webhook at the production URL and set the new
   `PAYPAL_WEBHOOK_ID`.
5. Make one real purchase yourself and refund it, to confirm the whole path.

Live credentials belong in your host's environment variables (Vercel → Settings
→ Environment Variables), never in the repository.

## How the money path works

```
member clicks a plan
  → server creates the subscription at PayPal          (no tier granted)
  → member approves at PayPal
  → PayPal redirects to /membership/return             (hint only, verified)
  → PayPal POSTs BILLING.SUBSCRIPTION.ACTIVATED        (authoritative)
  → signature verified, transmission id recorded
  → server RE-READS the subscription from PayPal
  → tier written, CEC library unlocks
```

Two things worth understanding:

**The return URL grants nothing.** It is under the member's control — they can
edit the `subscription_id` in it. The page checks the id belongs to them and
then asks PayPal what is actually true. It exists so the member sees the right
thing immediately; the webhook is what makes it real.

**`User.tier` is only ever written by `syncSubscription`**, which reads state
from PayPal. Nothing else in the codebase sets it, which is what keeps a forged
request from buying a membership.

## Known limitation: the three-month minimum

The marketing site advertises a three-month minimum term on paid plans. **PayPal
does not enforce minimum commitments** — a subscriber can cancel from their own
PayPal account at any time, and there is no API to prevent it.

The app's own cancel button could be made to refuse before three months, but
that only covers members who cancel *in the app*. If the minimum term matters
commercially it needs to live in your terms and conditions, not in the billing
system. Worth raising with the client before launch.
