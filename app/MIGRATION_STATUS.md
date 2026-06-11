# Migration Status

Tracks progress of the FastAPI → Next.js serverless migration.
Spec: `../docs/migration/` (`00`–`15`). Conventions: `CLAUDE.md`.

Layout: Next App Router lives in `app/`; backend code lives in `server/`
(imported via `@/server/*`). The whole API is one Hono app mounted at
`app/api/[[...route]]/route.ts`.

## Verified

- `npm run typecheck` → 0 errors. `npm run lint` → 0 errors (2 cosmetic unused-var
  warnings). `npm test` (Vitest) → passing. `next build` → succeeds, `/api/[[...route]]`
  dynamic on the Node runtime.
- Runtime smoke (via `next start`): OpenAPI 3.1 at `/api/doc`, Scalar UI at
  `/api/reference`, response envelope, validation (422) envelope, 404 envelope,
  and `X-Request-Id` / `X-RateLimit-*` / `Content-Language` / `X-Process-Time` headers.

## Implemented (all layers: route → service → repository → schema)

**Foundation** — settings (Zod env), mongo (cached client), envelope, errors, i18n
(en/fr), rate-limit (Upstash), role-config, request-context, OpenAPI/Scalar, the
`createRouter()` factory (bakes in the validation hook), `app.ts` (middleware chain
+ all router mounts + onError/notFound), and the catch-all entry.

**Security** — `jose` HS256 access tokens (audience-pinned), bcrypt + sha256 hashing,
`AuthPrincipal`, role↔audience map, `requireCustomer/requireCleaner/requireAdmin`
guards, role-account gateway.

**Auth & sessions** — unified JWT for all three roles; refresh-token families with
rotation + reuse detection (`sessions` collection + TTL); `revoke-others`/`revoke-all`/
`logout`; Google OAuth (authorization-code + PKCE, server-side, issues our tokens;
`oauth_states` collection + TTL).

**Domains**
- Customers: signup/login/refresh; profile, addresses, settings, language, account
  lifecycle (`/me/*`, `/profile/*`, `/settings/*`).
- Cleaners: signup/login/refresh + onboarding.
- Admins: login/refresh/profile + sessions; admin core (directory, permission
  templates + rollout, permissions catalog, access/elevation, monitoring, reporting,
  audit export on-demand); all 13 admin-feature CRUD routers via a generic factory.
- Bookings: create/list/get/accept/complete/acknowledge/mark-paid/rate + state machine
  + snake/camel query aliases + access checks.
- Payments: provider abstraction (Stripe / Flutterwave / test), methods CRUD,
  signature-verified webhooks (raw body), refund, reconcile.
- Places (Google Maps), Documents (S3/local storage abstraction), Reviews,
  Notifications, Banners.

**Email / async** — Resend client + React Email templates (otp, new-sign-in, invite,
revoke, password-reset); Vercel Cron routes (`reconcile-payments`, `account-lifecycle`,
`expire-cleanup`) secured by `CRON_SECRET`; `vercel.json` cron schedule.

## Known stubs / TODOs (search for `TODO` in `server/`)

These compile and return well-shaped responses but need real logic / parity wiring:

- **Pricing**: booking price is a passthrough stub (no `pricing-service` yet).
- **Admin analytics**: monitoring overview/heatmap/denied-top/anomalies and
  signups-trend return shaped zeroed data; aggregations pending.
- **Audit export**: on-demand record + JSON stub; wire S3/Blob signed-URL download.
- **Permission templates**: rollout/preview/impact record intent but don't re-apply
  permissions to existing accounts yet; permissions catalog is a static list.
- **Broadcast dispatch / concierge create-booking**: persist intent; real fan-out /
  booking-service delegation pending.
- **Saved-address place resolution**: stores `place_id`; detail resolution via
  place-service not yet wired.
- **Mobile-facing surface**: IMPLEMENTED — customer `/home`, public
  `/bookings/cleaners*` + `/bookings/services/{id}/extras` + `/services`, cleaner
  `/cleaner/jobs*` + `/cleaner/profile`, password-reset (`request`/`confirm`),
  notifications `read-all` + `POST /{id}/read`, and the `/sign-in`/`/sign-up`/
  `/bookings/create` + `extras`→`addons` hybrid aliases. Plan:
  `docs/superpowers/plans/2026-06-11-mobile-backend-endpoints.md`. Enrichment fields
  (`hourlyRate`, `certifications`, `yearsExperience`, `avatarUrl`, `distanceMiles`,
  `availableDays`) and booking `price` remain stubbed (null/empty) pending a
  cleaner-model extension + pricing-service. Cleaner-decline is "pass; booking stays
  in the pool" (records `declinedBy`, status unchanged). Reset links use the
  server-trusted `PUBLIC_APP_URL` env (default Vercel URL) — never the request Host.
- **`/profile/payment-methods` aliases**: still TODO (cross-domain).
- **`account-lifecycle` cron**: stub (`processed: 0`).
- **Field-shape parity**: schemas were rebuilt from the migration docs (the Python
  source was removed from the repo); exact field parity must be re-verified against
  the original Pydantic models / live clients (doc 13 golden-response tests, doc 15).

## Not yet runtime-tested against a live MongoDB

All DB-backed flows are typechecked and the HTTP/validation contract is runtime-verified,
but none have been exercised against a running Atlas/local Mongo. Set env (doc 11) and
run the doc-13 parity tests before cutover.

## Before deploying

- Set real env (doc 11): `MONGODB_URI`, `DB_NAME`, `JWT_SECRET` (≥32 chars), `UPSTASH_*`,
  `RESEND_API_KEY` + verified domain, payment + storage vars, `GOOGLE_*`, `CRON_SECRET`.
  Set `PUBLIC_APP_URL` to the real app/reset-page origin (used for password-reset links;
  defaults to the Vercel URL) — it must be a trusted value, never the request Host.
- Resolve open questions in doc 15 (admin credential source, URL-prefix strategy,
  Vercel plan for cron frequency, Resend sender branding, `/notificationss` spelling).
- Add golden-response + OpenAPI-snapshot parity tests (doc 13).
