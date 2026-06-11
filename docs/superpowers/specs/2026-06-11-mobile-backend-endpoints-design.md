# Design — Mobile-facing backend endpoints (customer + cleaner apps)

**Date:** 2026-06-11
**Status:** Approved (design); pending implementation plan
**Repo:** `Marcus-cleaning-backend` (Next.js 16 + Hono + `@hono/zod-openapi` + MongoDB), branch `master-nextjs`
**Source requirements:** `backend-requirements/` (`README.md`, `01-missing-endpoints.md`, `02-contract-mismatches.md`, `03-config-notes.md`)

---

## 1. Problem

Two Flutter apps (customer + cleaner) were built against a *guessed* API contract. The
`backend-requirements/` gap analysis (written against the **old Python** OpenAPI spec) lists
**10 genuinely-missing endpoints** and **~7 contract mismatches**. The real target is the **new
TypeScript rewrite** under `app/`, whose routes/shapes differ from that Python spec. This design
maps every requirement onto the current TypeScript backend and specifies the backend work to make
the apps able to run dynamically.

## 2. Decisions (locked with stakeholder)

1. **Compatibility strategy — Hybrid.** Add the 10 missing endpoints **and** cheap, low-risk
   backend aliases (extra path names, a `POST` mark-read alias, mark-all-read). Do **not** reshape
   the well-formed auth/booking response envelopes — those richer-shape fixes remain app-side.
2. **Home — bespoke aggregator.** A single `GET /api/v1/home` returns the composed `HomePageModel`.
3. **Cleaner jobs — dedicated `/cleaner/jobs` surface** returning the app's `CleanerJob` shape,
   mapped from the existing `bookings` collection under the hood.
4. **Cleaner profile/browse data — derive what we can, stub the rest.** Compute `rating`/
   `reviewsCount` from `reviews` and `jobsDone`/`bookingsCount` from `bookings`; return null/empty
   for `hourlyRate`, `yearsExperience`, `certifications`, `avatarUrl` (flagged follow-up).

## 3. Guiding principle (conventions to follow exactly)

- Strict layering: `routes → services → repositories → schemas`, plus `security/` + `core/`.
  Routes validate + delegate (no DB); services hold logic (no Hono/HTTP types — reusable by cron
  + tests); repositories own all Mongo access; schemas are Zod with inferred TS types.
- Routers built via `createRouter()`; endpoints via `createRoute(...)` + `.openapi(...)`.
- Responses via `ok(c, message, data)`; errors via `AppError`/helpers; envelope
  `{ success, message, data, requestId }` is mandatory and already matches the apps' `ApiClient`.
- OpenAPI 3.1 + Scalar pick up new routes **automatically** once the router is mounted in
  `server/app.ts` — no manual registry.
- Guards: `requireCustomer()` / `requireCleaner()` / `principalOf(c)` from `security/guards.ts`.
- Cursor pagination mirrors `booking-repo.getBookingsHistory` (opaque `_id` cursor, fetch
  `pageSize + 1`, stable `{field, _id}` sort).
- Email via existing `server/core/email/send.ts` helpers (safe from services).
- No new infrastructure. One new TTL collection (`password_reset_tokens`) following the existing
  `sessions` / `oauth_states` TTL pattern.

## 4. New routers & mounts (`server/app.ts`)

| Mount | File(s) | Purpose |
|---|---|---|
| `/api/v1/home` | `routes/home.ts` | Bespoke home aggregator |
| `/api/v1/cleaner` | `routes/cleaner-jobs.ts`, `routes/cleaner-profile.ts` | Cleaner self **jobs** + **profile** (singular `/cleaner`, distinct from the existing `/cleaners` auth router) |
| `/api/v1/services` | `routes/catalog.ts` | Public service-catalog read |
| `/api/v1/bookings` *(extend)* | `routes/bookings.ts` | `cleaners` browse, `cleaners/{id}`, `cleaners/{id}/reviews`, `services/{id}/extras`, `POST /create` alias |
| `/api/v1/customers` *(extend)* | `routes/customers.ts` | `password-reset/request` + `/confirm`, `/sign-in` + `/sign-up` aliases |
| `/api/v1/notifications` *(extend)* | `routes/notifications.ts` | `read-all`, `POST /{id}/read` alias |
| `/api/v1/reviews` *(extend)* | `routes/reviews.ts` | Query `stars` / `timePeriod` / `cursor` / `pageSize` |

> Mount-order note: `/api/v1/cleaner` must not shadow `/api/v1/cleaners`. Hono matches exact mount
> prefixes, so the two coexist; verify with a route-list smoke check.

## 5. Endpoint specification

All responses use the standard envelope. Auth column = required bearer role.

### 5.1 Customer

| # | Method + path | Auth | `data` payload | Backend work |
|---|---|---|---|---|
| 1a | `POST /customers/password-reset/request` | none | `null` (always 200, no email enumeration) | New `password-reset-service` + `password-reset-repo`; issue hashed token → `password_reset_tokens` TTL; send `sendPasswordResetEmail({to, resetUrl})` |
| 1b | `POST /customers/password-reset/confirm` | none | `null` | Verify token, set new password hash (reuse hash util), consume token, revoke customer sessions |
| 2 | `GET /home` | customer | `HomePageModel` | New `home-service` composes booking-repo (active+recent) + banner-repo + catalog projection + cleaner-directory |
| 3a | `GET /services` | customer | `[CatalogServiceOut]` | Public projection over `service_definitions` via generic `listDocs` |
| 3b | `GET /bookings/services/{serviceId}/extras` | customer | `[ServiceExtraOut]` = `{id,title,price,isAvailable}` | Public projection over `addon_catalog` via generic `listDocs`, filtered/defensive-mapped |
| 4 | `GET /bookings/cleaners?minRating&maxHourlyRate&onlyAvailableNow` | customer | `[CleanerCardOut]` | New `cleaner-directory-service`; list APPROVED cleaners; derive rating/reviewsCount (reviews) + jobsDone/bookingsCount (bookings); stub hourlyRate/yearsExperience/avatar |
| 5 | `GET /bookings/cleaners/{cleanerId}` | customer | `CleanerProfileOut` | Same derivation + `reviewPreview` = first N reviews |
| 6 | `GET /bookings/cleaners/{cleanerId}/reviews?cursor&pageSize&stars&timePeriod` | customer | `{items:[CleanerReviewOut], nextCursor}` | Add cursor + `stars`/`timePeriod` to `review-repo`; join `reviewerName` from customer-repo; stub avatar |
| 7a | `POST /notifications/read-all` | customer | `null` | New `markAllRead(customer_id)` (`updateMany read:true`) in notifications-repo + service |
| 7b | `POST /notifications/{id}/read` (alias) | customer | `NotificationOut` | Reuse existing read-flag update (hybrid; PATCH `/{id}` stays) |
| — | `GET /reviews?stars&timePeriod&cursor&pageSize` (extend) | open | `[ReviewOut]` (or paginated) | Extend `ReviewListQuery` + service for the same filters (hybrid) |

### 5.2 Cleaner

| # | Method + path | Auth | `data` payload | Backend work |
|---|---|---|---|---|
| 8 | `GET /cleaner/jobs` | cleaner | `[CleanerJobOut]` | New `cleaner-jobs-service` maps booking-repo (cleaner-scoped + unassigned pool) → `CleanerJob` |
| 9 | `GET /cleaner/jobs/{jobId}` | cleaner | `CleanerJobOut` | Map single booking → `CleanerJob` |
| 10a | `POST /cleaner/jobs/{jobId}/accept` | cleaner | `CleanerJobOut` | Delegate to existing accept transition + `cleaner_id` claim; return mapped job |
| 10b | `POST /cleaner/jobs/{jobId}/decline {reason?}` | cleaner | `CleanerJobOut` | New decline transition in `booking-state-machine` (default: cleaner passes, booking stays in pool — see §8) |
| 11a | `GET /cleaner/profile` | cleaner | `CleanerSelfProfileOut` | Map cleaner doc (`bio`, `skills`→`services`, `serviceAreaIds`); derive rating/reviewsCount/completedJobs; stub serviceRadiusMiles/availableDays/avatar |
| 11b | `PATCH /cleaner/profile {fullName,email,phone,bio,serviceRadiusMiles,services,availableDays}` | cleaner | `CleanerSelfProfileOut` | Map `fullName`→first/last; persist via `cleaner-repo.updateCleaner`; new minimal fields stubbed/added |

> Cleaner **auth** (`/cleaners/login|signup|refresh|onboarding`) already exists — no backend work;
> wiring is app-side (Config-notes 03).

### 5.3 Hybrid aliases (cheap, no envelope reshaping)

- `POST /customers/sign-in` → login handler; `POST /customers/sign-up` → signup handler.
- `POST /bookings/create` → booking-create handler; accept `extras` as an alias for `addons` in the
  create body (`placeId` stays required — the nested `location{}` object is an app-side fix).

## 6. New / changed schemas

New: `HomePageModel`, `CatalogServiceOut`, `ServiceExtraOut`, `CleanerCardOut`, `CleanerProfileOut`,
`CleanerReviewOut`, `CleanerJobOut`, `CleanerSelfProfileOut`, `PasswordResetRequest`,
`PasswordResetConfirm`.
Changed: `ReviewListQuery` (+`stars`, `timePeriod`, `cursor`, `pageSize`); optional `extras` alias on
the booking-create request.

## 7. Data & derivation rules

- **rating / reviewsCount** — aggregate over `reviews` filtered by `cleaner_id` (avg `rating`, count).
- **jobsDone / bookingsCount / completedJobs** — count `bookings` by `cleaner_id` (and `status`).
- **reviewerName** — join `customer_id` → `customer-repo` (`firstName + lastName`).
- **clientName** (cleaner job) — join `customer_id` → customer-repo.
- **title** (job / extras) — from catalog projection (`service_definitions` / `addon_catalog`).
- **address** (job) — from `place_id` (optionally resolved via place-service `details`; otherwise the
  stored `place_id`).
- **Stubbed (null/empty, flagged):** `hourlyRate`, `yearsExperience`, `certifications`, `avatarUrl`,
  `distanceMiles`, `isPriority`, `serviceRadiusMiles`, `availableDays`, booking `price`.

## 8. Open product point (defaulted)

**Cleaner decline semantics.** Bookings are unassigned until a cleaner accepts. Default chosen:
**decline = "this cleaner passes; the booking stays available to others"** (no global cancel). The
endpoint returns the mapped `CleanerJob` reflecting that. If product wants a hard cancel or a
per-cleaner suppression list, that's a one-line change to the transition + an optional
`declinedBy[]` field — noted, not built now.

## 9. Testing

Vitest at service / mapping / schema level (the backend is **not yet runtime-tested against live
Mongo**, so no DB-integration tests in this pass):
- `BookingOut → CleanerJob` mapping (all fields, stub defaults).
- rating / jobsDone aggregation math.
- reset-token issue / verify / expire / single-use; password-reset request always 200 (no
  enumeration).
- cursor pagination edges (empty, exactly `pageSize`, `pageSize + 1`).
- golden-shape envelope snapshot per new payload schema.

Gate: `npm run typecheck` + `npm run lint` + `npm test` all green before "done".

## 10. Out of scope / flagged follow-ups (explicitly not silently skipped)

- **App-side config (Config-notes 03):** Dio `/api` base-URL resolution, `.env` `API_BASE_URL`,
  cleaner app still on mocks, and the auth-model / `BookingOut` field-name reshaping — all live in
  the **Flutter** repo (not in this backend repo). All routes stay under `/api/v1`; canonical base
  URL documented.
- **Richer auth/booking response reshapes (per Hybrid):** token nesting / `expiresAt` / `fullName`,
  bare-array vs `{items}` booking list, `serviceTitle` / `cleanerName` / `totalAmount` display
  fields — required app-side changes.
- **Real cleaner enrichment + pricing:** `hourlyRate`, `certifications`, `yearsExperience`,
  `avatarUrl`, `distanceMiles`, `availableDays`, booking `price` — derived-or-stubbed now; real
  values need a cleaner-model extension + the (stubbed) pricing-service later.

## 11. Build sequence (phases → implementation plan)

1. **Foundations:** schemas + derivation helpers (rating/jobsDone aggregations in repos), cursor
   helper reuse. No routes yet.
2. **Customer read surface:** catalog projection (`/services`, service extras), cleaner directory +
   public profile, cleaner-scoped reviews (+ `/reviews` query extension).
3. **Home aggregator:** compose phase-2 pieces + banners + bookings into `/home`.
4. **Notifications:** `read-all` + `POST /{id}/read` alias.
5. **Password reset:** TTL repo + service + request/confirm routes + email wiring.
6. **Cleaner surface:** `/cleaner/jobs` (+accept/decline, state-machine decline) + `/cleaner/profile`.
7. **Hybrid aliases:** `/sign-in`, `/sign-up`, `/bookings/create`, `extras`→`addons`.
8. **Tests + verify:** typecheck/lint/test green; route-list + OpenAPI smoke.
