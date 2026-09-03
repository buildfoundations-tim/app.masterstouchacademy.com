# Roadmap

What exists, what does not, and the order to build the rest in.

The reference is `../masterstouchacademy.com/designs/Masters Touch Academy.dc.html`
— its `state` object is the complete data model and its `renderVals()` is the
view-model contract. `README.md` § "Backend: what needs to be built" enumerates
the tables. Neither is a sketch; both are the specification.

## Built

| Area | State |
| --- | --- |
| Signup, verification, sign-in, password reset | Done, working in production |
| Classroom — catalog with tier locks | Done |
| Course detail, lesson player shell, progress | Done; video is a placeholder |
| Final exam, scoring, certificates | Done |
| Class schedule with tier pricing | Done |
| Membership — PayPal subscriptions | Done, sandbox only |
| One-time purchases — courses and seats | Done, sandbox only, **never tested with a real payment** |
| Admin → Classes | Done |

## Not built

The prototype has nineteen sections. Seven exist. These do not:

Marketplace and cart · community forum · video library · on-demand ·
live sessions · Ask Captain Carpet AI · consulting booking · bookshelf ·
transcripts · Admin: members, orders, analytics, attendance, email, instructors,
approval queue · the instructor portal (a separate prototype)

Also missing from what *is* built: the top bar the prototype carries on every
screen — search, notifications, and the cart.

## Two known divergences from the design

**Checkout is a redirect, not inline.** The prototype shows PayPal embedded in
the page. This implementation sends the buyer to PayPal and back. Both are
legitimate, but they are not the same experience, and the difference was not
flagged when it was made. PayPal's JS SDK supports the inline flow; changing it
is phase 1 work, not a limitation.

**The video player is a placeholder.** It shows the asset key rather than a
player, because `vimeo-integration.md` requires the server to resolve an asset
key to a Vimeo id only after an entitlement check, and no Vimeo account exists
yet. A stand-in `<video>` would invite wiring it up the wrong way.

---

## Phase 1 — Finish the commerce path

Nothing else matters until money works end to end.

- **Prove a sandbox purchase.** Subscription and one-time, both paths, with the
  webhook granting access. Needs a PayPal sandbox buyer account.
- **Inline PayPal checkout** via the JS SDK, matching the prototype.
- **Cart** — the prototype lets you accumulate courses, seats, and marketplace
  items and check out once. Currently every purchase is a separate transaction.
- **Orders history** for the member, and Admin → Orders for the owner.
- **Refunds.** Issued in PayPal; the `PAYMENT.CAPTURE.REFUNDED` webhook marks
  the order refunded and withdraws the courses and seats it granted. A partial
  refund is recorded and flagged but withdraws nothing — which line it covers is
  not knowable from the event, so that stays a human decision.
- **App bar** — cart, notifications and the account menu in the top bar, as in
  the prototype. This also gave phones a navigation drawer; the sidebar used to
  be `display: none` below 900px, leaving no nav at all.
- **Go live on PayPal**: live credentials, live plans, live webhook. ← the only
  thing left in this phase.

Everything above is done and exercised in sandbox against real webhook
deliveries.

### Known gaps left in phase 1

- **Notifications are derived, not stored.** There is no Notification table;
  the bell reads bookings, orders and entitlements directly, and read/unread is
  one timestamp per member (`User.notificationsReadAt`). That is deliberate —
  see the note at the top of `src/lib/notifications.ts`. It means no per-item
  read state and no notification that outlives the record behind it.
- **No search in the app bar.** The prototype has one. There is nothing to
  search yet — no community, no marketplace — and a search box that returns
  nothing is worse than no search box.

## Phase 2 — Admin

Tom cannot run the school from the app yet; he can only edit class dates.

- **Members** — list, search, view a member, adjust tier by hand, grant a course.
- **Orders** — what was bought and what a payment granted. Refunds already
  land here from PayPal; what is missing is issuing one from this screen, and
  resolving a flagged partial refund by hand.
- **Attendance** — roll call per class, which drives certification credit.
- **Course builder** — modules and lessons without a database client. This is
  what makes the catalog editable by the client rather than by a developer.

At the end of this phase `inc/data.php` on the marketing site should read from
an API here rather than holding its own copy. Right now the two are synced by
hand and will drift.

## Phase 3 — Video

- Vimeo account, privacy set to whitelist, downloads disabled.
- `GET /api/video/:assetKey` — entitlement check, then return only
  `{ videoId, hash, expiresAt }`. **A file URL never reaches the client.**
- Player with throttled progress posts, resume, and completion.
- Upload flow so lessons can be given asset keys from Admin.

Blocked on: a Vimeo account. See `../masterstouchacademy.com/vimeo-integration.md`
— it is a requirements document, not a suggestion.

## Phase 4 — The rest of the member experience

- **Top bar**: search, notifications, cart.
- **Video library** and on-demand browsing.
- **Community forum** — threads, replies, likes. The prototype treats this as
  the feature members use most.
- **Bookshelf** — eBooks included with paid tiers.
- **Transcripts** — CE hours by cycle, exportable for IICRC renewal.
- **Consulting booking** — the four sessions a year Pro+ includes.

## Phase 5 — Instructor portal

A separate prototype: `designs/Masters Touch Instructor Portal.dc.html`.
Application, course builder, payouts. Restore the sidebar's Teaching group when
`/instructor` exists.

## Phase 6 — Ask Captain Carpet AI

`designs/manual-excerpts.js` carries the corpus and the retrieval contract:
answer only from the excerpts, cite with `SOURCE:` lines, never guess. The
prototype calls `window.claude.complete()`, which only exists in the Claude
Design host — production needs a real model call behind an authenticated route,
with per-tier metering.

Open question from `README.md`: how AI usage is metered and capped.

---

## Decisions still owed by the client

From `README.md` § "Known gaps", unchanged:

- Whether class recordings are gated per seat or included with a tier
- How long recordings stay available after a membership lapses
- Whether to watermark higher-priced IICRC content
- AI metering limits
- Coupon rules
- How IICRC completion is reported

And one found during implementation: **PayPal cannot enforce the advertised
three-month minimum term.** A subscriber can cancel from their own PayPal
account at any time. If that term matters commercially it belongs in the terms
and conditions, not the billing system.
