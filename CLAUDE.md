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

- `tom@masterstouchacademy.com` — owner + instructor, tier 4
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
- **Access = purchased, OR (tier >= 2 AND group === 'cec')**. IICRC certification courses are a la
  carte at *every* tier — including tier 4. An owner at tier 4 seeing an IICRC course unlocked
  without an entitlement is a bug, not a convenience.
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

**Done**: schema (18 tables), initial migration, seed, access rules, auth, app shell, classroom
course list with lock states.

**Not built**: lesson player and progress writes, quizzes and the final exam, certificates, class
booking, the 13-section Admin, community, marketplace, consulting, messaging, the AI assistant.

**Commerce is entirely absent — there is no checkout.** `Entitlement` rows can only be created by
seed or by hand until a payment processor is chosen; that is still an open question in
`README.md` § "Known gaps". Sidebar links to `/schedule`, `/certificates`, `/membership`,
`/instructor`, and `/admin/*` are routed but those pages do not exist yet.

Video is specified but unimplemented: see `../masterstouchacademy.com/vimeo-integration.md`. The
rule that matters — a video file URL never reaches the client; the server resolves an `assetKey` to
a Vimeo id only after an entitlement check.
