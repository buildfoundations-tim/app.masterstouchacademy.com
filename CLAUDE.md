@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `AGENTS.md` above is generated and re-added by `next dev` — leave that block alone. Its point
> stands: this is Next.js 16, with breaking changes from earlier versions. The authoritative docs
> are in `node_modules/next/dist/docs/`; read them rather than working from memory.

## What this is

The **member app** ("the classroom") for Masters Touch Academy, a restoration-industry training
platform. Next.js 16 (App Router) + React 19 + Prisma 7 + Postgres.

This is a **separate application from the marketing site**, which lives at
`../masterstouchacademy.com` (hand-written PHP on shared Apache hosting, deployed by git-ftp).
They target different hosts deliberately: shared Apache cannot run a Node process.

| Surface | Where | Host |
| --- | --- | --- |
| Marketing site | `../masterstouchacademy.com` | Shared Apache, git-ftp |
| Member app (this) | here | Node host (Vercel intended), `app.masterstouchacademy.com` |

**Product source of truth**: `../masterstouchacademy.com/README.md` (scope, tiers, commerce model,
full backend model) and `../masterstouchacademy.com/designs/Masters Touch Academy.dc.html` (the
~6,500-line prototype — `state` is the mock dataset, `renderVals()` the view-model contract).
Read those before adding features; do not invent product behavior.

## Commands

```bash
npm run dev
```

Also: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run db:migrate`, `npm run db:seed`,
`npm run db:studio`.

### Local database

There is no Docker or system Postgres on this machine. Prisma ships one:

```bash
npx prisma dev -d -n mta
```

`npx prisma dev ls` then prints the TCP URL — paste it into `.env` as `DATABASE_URL`. **The port is
assigned at start and changes between restarts**, so re-check it if the app suddenly cannot connect.

Seed users (password `academy-dev-2026`), one per tier so the access rules are visible immediately:

- `tom@masterstouchacademy.com` — role `owner`, **no membership tier**
- `pro@example.com` — tier 2, sees the CEC library open
- `community@example.com` — tier 1, sees everything locked

## Prisma 7 — not like Prisma 5/6

Three breaking differences that will waste time if assumed away:

1. **`url` is not allowed in the `datasource` block.** The CLI reads it from `prisma.config.ts`;
   the runtime client gets it through a **driver adapter** (`@prisma/adapter-pg`) in `src/lib/db.ts`.
2. The generator is **`prisma-client`** (not `prisma-client-js`) and needs an explicit `output` —
   here `src/generated/prisma`, imported as `@/generated/prisma/client`.
3. The generated client uses **extensionless internal imports**, which Node's native TS stripping
   rejects. Scripts importing it must run under `tsx`, not `node --experimental-strip-types` —
   which is why `db:seed` is `tsx prisma/seed.ts`.

npm's `latest` tag for `prisma` is currently an **8.0.0 release candidate**. This project pins
stable **7.10.0** deliberately; do not let an install float it to the RC.

## Architecture

### Route groups

- `src/app/(auth)/` — sign-in. Public.
- `src/app/(app)/` — everything behind the login. **The auth gate lives in `(app)/layout.tsx`**, so
  a new page under it is protected by default and would have to opt *out*. Keep it that way.

### The rules that carry the business model

`src/lib/access.ts` is the only place tier and entitlement logic lives:

- **Tier is an ordinal `Int` 1–4**, never an enum: 1 Community, 2 Pro, 3 Pro+, 4 Crew Leader.
  Comparisons are `>=`.
- **Role is not tier.** `User.role` (`member | instructor | owner`) says what someone *is*;
  `tier` says what a member *pays for*. Staff carry **no tier** — they sit at 1 and are labelled
  by role everywhere, via `roleLabel()`. Running the school used to be expressed as `isOwner`
  plus a tier of 4, which made the owner read as a Crew Leader subscriber in every list and
  upsell banner. Do not put staff back on a tier.
- **Access = purchased, OR (tier >= 2 AND group === 'cec'), OR (staff AND group === 'cec')**.
  IICRC certification courses are a la carte for *everyone*, staff included — an owner seeing an
  IICRC course unlocked without an entitlement is a bug, not a convenience. Staff get the CEC
  library because they publish it, which is exactly what the old tier-4 owner had.
- Discounts: Pro 10%, Pro+ and Crew Leader 20%, on class seats and marketplace items.

All enforced server-side. A tier or entitlement arriving from the client is never trusted.

`scripts/check-access.ts` asserts these against the real seeded database — **run it after touching
`access.ts` or the pricing data**:

```bash
npx tsx scripts/check-access.ts
```

It also guards the pricing invariant that live stream is exactly $100 under the classroom seat,
with CRT the one documented exception (live-stream students are shipped hands-on materials, so it
prices *above*).

### Auth

`src/lib/auth.ts`. Argon2id passwords. Sessions are server-side rows storing only a SHA-256 hash of
the cookie token, so a database leak does not yield live sessions. Sign-in failures are uniform in
both message and timing — a decoy hash is verified when the email does not exist — so the endpoint
cannot enumerate accounts. **Do not add a "no such user" branch.** The `next` redirect parameter is
validated as a same-site path; do not relax that into an open redirect.

### Styling

Plain CSS in `src/app/globals.css`, no Tailwind. Tokens are the **same approved palette as the
marketing site** — `Instrument Serif` for display, `Work Sans` for UI, no color outside the token
set. Fonts load through `next/font`, so they are self-hosted and the visitor's browser makes no
request to Google.

## State of the build

**Done**: schema, migrations, seed, access rules, the full account lifecycle (signup, email
verification, password reset), the classroom, lesson player and progress, the final exam and
certificates, the class schedule, owner class admin, and PayPal for both subscriptions and
one-time purchases.

**Not built**: much of the 13-section Admin (Classes, Courses, Orders, Members and Attendance
exist; quiz/exam question editing does not), community, marketplace,
consulting, messaging, the AI assistant, crew management, and the instructor portal. The sidebar
links only pages that exist; `/instructor` is deliberately absent until it is built.

**Commerce is wired but unconfigured.** PayPal subscriptions and one-time purchases are built and
tested; nothing can actually be bought until the credentials in `docs/paypal-setup.md` are set.
Every purchase surface degrades to a disabled button with an explicit warning rather than a
half-working checkout. `User.tier` is only ever written by `recalcUserTier()` in `src/lib/tier.ts` —
nothing else in the codebase sets it. It derives the tier from subscriptions, except for staff
(who have none) and for a **hand-set tier**: `User.tierOverride`, which the owner sets from
Admin → Members. Without that column an override would be silently undone by the next
subscription webhook.

## Email and the account lifecycle

`src/lib/mail.ts` has three transports chosen by `MAIL_TRANSPORT`: `console` (default — writes the
message and its links to the server log, sends nothing), `resend` (one HTTPS call, no extra
dependency), and `smtp` (nodemailer; works with the same mail host the marketing site uses).

The console transport is deliberate: signup, verification, and password reset are fully testable
before anyone signs up for an email provider. Grep the dev server log for `EMAIL (console` to find
the link.

Tokens for verification and reset are stored as SHA-256 hashes, exactly like sessions — the raw
value exists in the email and nowhere else. Single use, expiring (24h verify, 1h reset), and
issuing a new one supersedes any earlier unused token for that purpose. **A password reset deletes
every session for that user**, because a reset prompted by a compromise must not leave the attacker
signed in.

**Signup does not reveal whether an address already has an account.** Both paths show "check your
email"; a new address gets a verification link, an existing one gets a "you already have an account"
note addressed to the real owner. Do not "improve" this into an `Email already taken` error — it is
the same anti-enumeration stance as the sign-in form.

Video is specified but unimplemented: see `../masterstouchacademy.com/vimeo-integration.md`. The
rule that matters — a video file URL never reaches the client; the server resolves an `assetKey` to
a Vimeo id only after an entitlement check.
