# Deploying the member app

Vercel for the app, Neon for Postgres, DirectAdmin for the DNS record. Both
providers have free tiers that comfortably cover launch.

The marketing site is **not** affected by any of this. It stays on your own
server and deploys with `git ftp push` as it does today.

```
masterstouchacademy.com       →  your DirectAdmin server   (marketing site, PHP)
app.masterstouchacademy.com   →  Vercel                    (this app)
                              →  Neon                      (Postgres)
```

---

## 1. Neon — the database

1. Sign up at <https://neon.tech> (GitHub, Google, or email).
2. **Create project.** Name it `masterstouchacademy`. Region: **AWS us-east-2
   (Ohio)** — closest to Cleveland and to your members.
3. Neon shows a connection string. Copy the **pooled** one (it contains
   `-pooler`). It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

Keep it to hand — it becomes `DATABASE_URL` on Vercel.

> **Pooled vs direct.** Serverless functions open many short-lived connections;
> the pooled endpoint is built for that and the direct one will exhaust
> connections under load. Use pooled for `DATABASE_URL`. Migrations are the
> exception — see step 5.

## 2. Get the code into GitHub

Vercel deploys from a Git repository. This repo is currently local only.

1. Create an **empty private repo** at <https://github.com/new> — call it
   `app.masterstouchacademy.com`. Do not add a README or .gitignore.
2. From `C:\projects\app.masterstouchacademy.com`:

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/app.masterstouchacademy.com.git
   git push -u origin master
   ```

`.env` is gitignored, so no secrets go up. Confirm with `git ls-files | findstr .env`
— it should show only `.env.example`.

> Prefer not to use GitHub? `npx vercel deploy` works without it, but you lose
> deploy-on-push, which is most of the value.

## 3. Vercel — the app

1. Sign up at <https://vercel.com> with the same GitHub account.
2. **Add New → Project → Import** the repo. Vercel detects Next.js; leave the
   build settings alone.
3. Before the first deploy, add the **Environment Variables** below.
4. **Deploy.**

### Environment variables

Set these for **Production** (and Preview, if you want preview deploys to work).
Everything except `DATABASE_URL` and `APP_URL` you already have in your local
`.env`.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | the pooled Neon string from step 1 |
| `APP_URL` | `https://app.masterstouchacademy.com` |
| `AUTH_SECRET` | fresh value — `openssl rand -base64 32` |
| `PAYPAL_ENV` | `sandbox` at first, `live` when you go live |
| `PAYPAL_CLIENT_ID` | from the PayPal dashboard |
| `PAYPAL_CLIENT_SECRET` | from the PayPal dashboard |
| `PAYPAL_WEBHOOK_ID` | from the PayPal dashboard |
| `PAYPAL_PLAN_*` (six of them) | printed by `npm run paypal:setup` |
| `MAIL_TRANSPORT` | `resend` or `smtp` — **not** `console` in production |
| `MAIL_FROM` | `Masters Touch Academy <no-reply@masterstouchacademy.com>` |
| `RESEND_API_KEY` *or* `SMTP_*` | depending on the transport |

**`APP_URL` matters.** It is what PayPal sends buyers back to and what goes in
verification and reset links. Wrong here means broken emails and broken returns.

**`MAIL_TRANSPORT` must not be `console` in production** — that transport writes
to the log and sends nothing, so nobody would ever receive a verification or
reset email. Since you run your own mail server, `smtp` with your existing
credentials is the least new machinery.

## 4. DNS in DirectAdmin

1. DirectAdmin → **DNS Management** for `masterstouchacademy.com`.
2. Add a **CNAME**:

   | Name | Value |
   | --- | --- |
   | `app` | `cname.vercel-dns.com.` |

   (Trailing dot if DirectAdmin doesn't add one.)
3. In Vercel → project → **Settings → Domains** → add
   `app.masterstouchacademy.com`. It verifies once DNS propagates — usually
   minutes, occasionally up to an hour.

Vercel issues the TLS certificate automatically. Don't create the subdomain as a
document root in DirectAdmin — the CNAME sends it away from your server, and an
A record or a real vhost would fight it.

## 5. Run the migrations

Migrations need a **direct** (non-pooled) connection — the pooled endpoint does
not support the session-level locks migrations take. Neon shows both; the direct
one is the same string without `-pooler`.

From your machine:

```bash
cd C:\projects\app.masterstouchacademy.com
DATABASE_URL="<DIRECT neon string>" npx prisma migrate deploy
```

`migrate deploy` applies committed migrations and never generates new ones —
that is the right command for production. Then seed the catalog:

```bash
DATABASE_URL="<DIRECT neon string>" npm run db:seed
```

**This creates no user accounts.** Demo users require `SEED_DEMO_USERS=true`,
which must never be set in production — they carry a password that is written
down in this repository.

## 6. Create the owner account

1. Visit `https://app.masterstouchacademy.com/signup` and sign up as Tom.
2. Promote that account:

   ```bash
   DATABASE_URL="<DIRECT neon string>" npx tsx scripts/make-owner.ts tom@masterstouchacademy.com
   ```

That sets `isOwner`, `isInstructor`, and tier 4, which unlocks `/admin/classes`.
The script only promotes an existing account — it cannot create a login.

## 7. Point the marketing site at the app

In `../masterstouchacademy.com`, `login.php` is currently a waitlist because the
classroom did not exist. Once the app is live, its call to action should go to
`https://app.masterstouchacademy.com/signin`, and the header "Sign in" link with
it. One small change in that repo, then `git ftp push`.

## 8. PayPal, live

Do a full sandbox purchase first — see `docs/paypal-setup.md`. When you are
satisfied:

1. PayPal dashboard → toggle **Live** → create a Live app → new client id and
   secret.
2. Set `PAYPAL_ENV=live` plus the live credentials on Vercel.
3. `npm run paypal:setup` again with the live credentials — **live plan ids are
   different**. Replace all six `PAYPAL_PLAN_*` values.
4. Create a **Live** webhook at
   `https://app.masterstouchacademy.com/api/paypal/webhook` with the same nine
   events, and set the new `PAYPAL_WEBHOOK_ID`.
5. Buy something yourself with a real card, confirm access is granted, then
   refund it.

---

## Checks after deploying

```
/signin                     loads
/signup                     creates an account, verification email arrives
/verify?token=…             confirms
/forgot → /reset            resets, old password stops working
/classroom                  catalog renders, locks correct for the tier
/membership                 plans priced, buttons live, no config warnings
/admin/classes              200 for the owner, 404 for a member
/api/paypal/webhook  (GET)  405
```

The one that is easy to miss and expensive to get wrong: **make a sandbox
purchase and confirm the tier actually changes.** The webhook is what turns a
payment into a membership, and it is the only part that cannot be tested from
localhost.

## Costs

| | Free tier | When you would outgrow it |
| --- | --- | --- |
| Vercel | Hobby: free | Commercial use technically wants Pro at $20/mo |
| Neon | 0.5 GB storage, autosuspend | A few thousand members |
| Resend | 3,000 emails/month | Fine for a long while |

Vercel's Hobby tier is not licensed for commercial use. For a business taking
payments, budget **$20/mo for Vercel Pro**. Neon and Resend free tiers are
genuinely fine at this scale.
