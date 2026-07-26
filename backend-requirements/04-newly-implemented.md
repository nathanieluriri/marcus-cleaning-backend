# 04 — Newly Implemented (answer to the frontend integration guide)

Everything the frontend's integration guide listed as missing is now built. This file is the
delta: the new endpoints, and the contract decisions the guide asked us to make.

Base URL: `https://marcus-cleaning-backend.vercel.app/api`
Live contract: Scalar UI at `/api/reference`, OpenAPI 3.1 JSON at `/api/doc` — that is
authoritative over this document.

---

## 1. Contract decisions (the frontend's §4, answered)

| Question | Decision |
|---|---|
| Error shape | `{ success, message, data: { code, details }, requestId }` — the code is at **`data.code`**, not `error.code`. `message` is already localized via `Accept-Language` (en/fr). |
| Auth | Self-issued JWT, HS256, bearer. Access TTL **900s**. Refresh is opaque, DB-tracked, **rotating** with reuse detection — store the new refresh token on every refresh, the old one is dead. |
| One user model or two | **Two.** Separate collections, separate signup/login, audience-pinned tokens. Customer app → `/v1/customers/*`; staff app → `/v1/cleaners/*` + `/v1/cleaner/*`. No shared `/auth/sign-in`, no role flag. |
| ID format | Mongo ObjectId hex — 24-char lowercase strings. Keep them `String`. |
| Money | Customer-facing prices are **major-unit decimals** + `currency` (`price: 45.5`). The payments layer uses integer **minor** units (`amountMinor`). Not yet unified — flag if you want the change. **The server computes every total**; `POST /bookings` recomputes the price from the catalog and ignores anything the client sends. |
| Timestamps | **Integer Unix epoch seconds**, not ISO-8601. Parse with `DateTime.fromMillisecondsSinceEpoch(v * 1000, isUtc: true)`. |
| Pagination | **Cursor**, everywhere: `?cursor=&pageSize=` → `{ items, nextCursor, pageSize }`. Used by bookings, payouts, support tickets. |
| Idempotency | **Honoured** on `POST /bookings`, `POST /cleaner/jobs/{id}/complete`, and `POST /cleaner/payouts/cash-out`. Send `Idempotency-Key`. Same key + same body replays the original response; same key + different body → 409 `IDEMPOTENCY_KEY_REUSED`; replay while in flight → 409 `IDEMPOTENCY_IN_PROGRESS`. Records expire after 24h. |
| Payments | Provider-abstracted (Stripe / Flutterwave / test), webhooks signature-verified. Stripe path uses PaymentIntents — **collect card data with the Stripe SDK; the backend never sees a PAN**. |
| File upload | **Pre-signed**, as you preferred. Accepted: `image/png`, `image/jpeg`, `image/heic`, `image/webp`, `application/pdf`. Max **10MB** (`DOCUMENT_MAX_UPLOAD_BYTES`). Both are enforced server-side and readable at `GET /v1/cleaner/applications/upload-rules`. |
| Realtime | **Polling for v1.** Chat returns `pollIntervalSeconds` (5s) in every message page. Job/ETA status: poll `GET /v1/bookings/{id}`, 15–30s while a job is active. Push covers the rest. |
| Push | **FCM HTTP v1** (iOS via FCM's APNs bridge). Register with `POST /v1/devices`. Unconfigured FCM degrades to pull-only — notifications still persist. |

---

## 2. New endpoints

### Bookings

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/bookings/{booking_id}/cancel` | Customer **or** assigned cleaner. Fee computed server-side; returns `{ booking, fee, feePercent, refund, policy, hoursUntilStart }`. |
| POST | `/v1/bookings/{booking_id}/reschedule` | Blocked within 2h of the start, or for a past target time. |

Cancellation bands (server-owned, `services/cancellation-policy.ts`): never accepted → free;
≥24h → free; ≥2h → 25%; <2h → 50%; after the start → 100%.

### Cleaner job lifecycle — the timer now has a server owner

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/cleaner/jobs/{jobId}/start` | Returns the authoritative `startedAt`. **Idempotent** — a repeat resumes the same session, so a crash or backgrounding no longer loses elapsed time. |
| GET | `/v1/cleaner/jobs/{jobId}/session` | Resume the timer. `durationSeconds` is always derived server-side, never accepted from the client. |
| GET | `/v1/cleaner/jobs/{jobId}/checklist` | Tasks derived from the booking's **service + the add-ons the customer actually picked**. |
| POST | `/v1/cleaner/jobs/{jobId}/checklist/{taskId}` | `{ done: bool }`. |
| POST | `/v1/cleaner/jobs/{jobId}/complete` | **Idempotent.** Returns duration, earnings, commission, gross, task counts. |
| POST | `/v1/cleaner/jobs/{jobId}/sos` | `{ kind, note?, lat?, lng? }`. Persisted **first**, then alerted, so a downstream failure cannot lose it. Surfaces at `GET /v1/admins/sos-alerts`. |
| GET | `/v1/cleaner/today` | Jobs dashboard: `stats { earnedToday, hoursToday, jobsToday, rating }`, `nextJob`, `jobs`. |

### Cleaner application wizard

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/cleaner/applications` | The caller's application; creates an empty draft on first access. |
| POST | `/v1/cleaner/applications` | Create or patch the draft. Every field optional — patch step by step. |
| PATCH | `/v1/cleaner/applications/{id}` | Same, id-scoped. |
| GET | `/v1/cleaner/applications/{id}` | Verification status screen. |
| POST | `/v1/cleaner/applications/{id}/documents` | `{ documentId, kind }` after the presigned upload completes. Re-uploading a kind replaces it. |
| POST | `/v1/cleaner/applications/{id}/submit` | 400 with `details.missingRequirements` if incomplete. |
| GET | `/v1/cleaner/applications/upload-rules` | Accepted MIME types + max bytes, so your UI copy always matches the server. |

Every read includes **`missingRequirements`**, **`canSubmit`** and **`canEdit`** — drive the wizard's
gating off those rather than reimplementing the rules.

**State machine:** `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | MORE_INFO_REQUIRED`;
`MORE_INFO_REQUIRED → SUBMITTED`; `REJECTED → MORE_INFO_REQUIRED` (admin reopen only).
The cleaner may edit **only** in `DRAFT` and `MORE_INFO_REQUIRED`. `APPROVED` is terminal.

**Payout details are never stored raw.** Send `{ provider, accountToken, accountHolderName?,
bankName?, last4?, currency? }` — tokenize with the payment provider client-side. Reads come back
redacted; the token is never echoed.

### Earnings & payouts

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/cleaner/earnings?period=week\|month\|year` | Totals + the per-bucket `series` for the bar chart (7 days / 30 days / 12 months, UTC buckets). |
| GET | `/v1/cleaner/balance` | `available`, `pending`, lifetime figures, `nextPayoutAt`, `cashOutMinimum`, `cashOutFee`, `canCashOut`. |
| GET | `/v1/cleaner/payouts` | Cursor-paginated history with status. |
| POST | `/v1/cleaner/payouts/cash-out` | Instant cash-out. **Idempotent.** 400 if payout details are missing or below the minimum; 409 if it exceeds the available balance. |

Earnings are **derived** from completed job sessions, so they cannot drift from the jobs that
produced them. Default platform commission 20% (`PLATFORM_COMMISSION_PERCENT`), cash-out minimum 20
and fee 1.5 — all env-tunable. Automatic payouts are weekly, Friday 00:00 UTC.

### Calendar & availability

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/cleaner/schedule?from=&to=` | Jobs grouped per day, with per-day earnings. Defaults to the next 30 days. |
| GET | `/v1/cleaner/availability` | Weekly pattern **and** dated overrides. |
| PUT | `/v1/cleaner/availability` | `{ weekly?, overrides?, timezone?, acceptingJobs? }`. |

Answering your question directly: availability is **both** — a recurring weekly rule (`weekly`) and
concrete dated exceptions (`overrides`), where an override wins for the day it names.
`acceptingJobs: false` pauses offers without destroying the pattern.

### Chat

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/conversations` | The caller's conversations + `totalUnread` for the badge. |
| POST | `/v1/conversations` | `{ bookingId }` — opens/reopens. 400 until a cleaner is assigned. |
| GET | `/v1/conversations/{id}` | Includes `counterpartName` and `unreadCount`. |
| GET | `/v1/conversations/{id}/messages?after=&before=&pageSize=` | `after` = poll, `before` = back-scroll. Returns `latestSequence`, `hasMore`, `pollIntervalSeconds`. |
| POST | `/v1/conversations/{id}/messages` | `{ body, attachmentDocumentId?, clientMessageId? }`. Send `clientMessageId` — it makes a retry idempotent and lets you reconcile your optimistic message. |
| POST | `/v1/conversations/{id}/read` | `{ upToSequence? }` → `{ updated, unreadCount }`. |

Conversations are scoped to a booking; access follows booking access. Fetching marks the other
party's messages **delivered**; `/read` marks them **read**. Both stamps live on the message, so
moving to sockets later changes the transport, not the payloads. Chat pushes deliberately do not
create notification rows — the chat screen is the inbox.

### Notifications & push

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/notifications/unread-count` | `{ unread }` — the tab badge. |
| POST | `/v1/devices` | `{ token, platform, deviceId?, appVersion?, locale? }`. Upsert on token, so re-registering is safe and handles account switching. |
| GET | `/v1/devices` | The caller's registrations. |
| DELETE | `/v1/devices/{id}` | Call on logout. |

`GET /v1/notifications`, `/read-all` and `/{id}/read` now serve **cleaners as well as customers** —
each role sees only its own feed. Push payload `data` carries `type`, `notificationId`, and the
relevant `bookingId` / `conversationId`; the APNs badge is set to the live unread count.

### Promotions, FAQ, support

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/promotions` | Active promo cards for the home screen. |
| POST | `/v1/promotions/validate` | `{ code, subtotal, serviceId?, currency? }` → `{ discount, total, promotion }`. |
| GET | `/v1/faq?audience=customer\|staff\|all` | **Unauthenticated** — the help screen works before sign-in. |
| POST | `/v1/support/tickets` | `{ subject, message, category, bookingId?, attachmentDocumentIds[] }`. |
| GET | `/v1/support/tickets` | Cursor-paginated. |
| GET | `/v1/support/tickets/{id}` | |

A rejected promo code returns **400** with a typed `data.details.reason`, so checkout can show a
specific message: `NOT_FOUND`, `EXPIRED`, `NOT_STARTED`, `INACTIVE`, `MINIMUM_SPEND_NOT_MET`,
`USAGE_LIMIT_REACHED`, `ALREADY_USED`, `NOT_APPLICABLE_TO_SERVICE`.

### Admin (operator side of the above)

`GET /v1/admins/applications`, `PATCH /v1/admins/applications/{id}/decision`,
`GET /v1/admins/sos-alerts`, `PATCH /v1/admins/sos-alerts/{id}`.

---

## 3. Still open

- **Apple sign-in** is not built. Google is (server-side authorization-code + PKCE at
  `/v1/customers/oauth/*` and `/v1/cleaners/oauth/*`).
- **`distanceMiles` / `isPriority`** on cleaner jobs are still `null` / `false` — no geo matching
  behind them yet. Don't build the radius filter against live data.
- **Money representation is not unified** (major units customer-side, minor units in payments).
  Say the word and we'll move everything to minor units.
- **Cash-out settlement** creates a PENDING payout and reserves the balance; actual provider money
  movement is reconciled by cron and is not wired to a live provider account yet.
- **Sockets.** Everything realtime is polling plus push for v1.

## 4. New environment variables

`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `PAYOUT_CASH_OUT_MIN` (20),
`PAYOUT_CASH_OUT_FEE` (1.5), `PLATFORM_COMMISSION_PERCENT` (20),
`DOCUMENT_MAX_UPLOAD_BYTES` (10485760). All optional except FCM, which push requires.

## 5. New collections

`idempotency_keys` (TTL 24h), `job_sessions`, `sos_alerts`, `cleaner_applications`, `payouts`,
`cleaner_availability`, `conversations`, `chat_messages`, `devices`, `support_tickets`,
`promo_redemptions`, and `faq_entries` (admin-editable FAQ copy).
