# 14 — Migration Plan (Phased Cutover)

A phased plan to move from the Python/FastAPI backend to the Next.js serverless backend with **zero data migration** (Mongo stays) and **minimal client disruption** (contract parity).

## Guiding constraints

- **One web app (admin) + two mobile apps (customer, cleaner)** are live against the current API. They cannot all redeploy at once — the new backend must serve the existing contract.
- **Same database.** Both backends can point at the same Atlas cluster during transition, which makes a gradual cutover and instant rollback possible.
- **Auth is the riskiest change** (admin moves off Auth0). Sequence it carefully.

## Phase 0 — Foundations (no behavior change)

1. Scaffold the Next.js app, Hono catch-all, `core/` (settings, mongo client, envelope, errors, i18n, rate-limit), and the OpenAPI/Scalar wiring (`01`, `04`, `05`, `11`, `12`).
2. Stand up Atlas (point at existing cluster), Upstash, Resend (verify domain), S3 access (`11`).
3. Create the `sessions` + `oauth_states` collections and TTL indexes (`02`, `03`).
4. CI: Vitest, type-check, OpenAPI snapshot (`13`).
5. Deploy a skeleton to a **preview/staging** URL with `/health` green.

**Exit:** staging responds, DB connectivity verified, docs render at `/api/reference`.

## Phase 1 — Auth (unified JWT)

1. Implement JWT sign/verify, refresh families, rotation + reuse detection, guards, OAuth, session controls (`03`).
2. Port `customer`/`cleaner`/`admin` signup/login/refresh + session endpoints (`07`).
3. **Admin transition:** admins currently authenticate via Auth0. Provide a backend `POST /v1/admins/login` (already in the inventory) issuing our JWT. Decide credential source: (a) migrate admins to local password auth (set/reset password flow), or (b) keep an Auth0 *login* bridge that exchanges an Auth0 token for our JWT during a grace window. **Recommended:** add backend admin login + a one-time password-set email (Resend), and run an Auth0 bridge endpoint temporarily for in-flight sessions.
4. Parity tests for login/refresh shapes + rotation/reuse (`13`).

**Exit:** all three roles can authenticate and refresh against staging; reuse detection verified.

## Phase 2 — Core domains

Port in dependency order, each with route + service + repo + parity tests:

1. **Users & profiles** — customers, cleaners (profile, addresses, settings, language).
2. **Places** — autocomplete/details/reverse-geocode/history (`fetch`-based Maps client).
3. **Bookings** — create/list/get/accept/complete/acknowledge/mark-paid/rate + state machine + the snake/camel query aliases.
4. **Payments** — provider abstraction, methods CRUD, webhooks, refund, manual reconcile (`09`).
5. **Reviews, notifications, banners, documents.**

**Exit:** customer + cleaner mobile flows pass parity against staging.

## Phase 3 — Admin suite

1. Admin core (directory, permission templates + rollout, elevation, permissions catalog).
2. Admin monitoring + reporting (overview, heatmap, anomalies, alerts, audit history).
3. **Audit export** — on-demand/streamed or cron-backed (`10`), keeping the create→status→download contract.
4. All admin feature CRUD sub-routers (pricing rules, promo codes, service areas, concierge, claims, broadcasts, credits, payouts, tags, catalogs).

**Exit:** admin web app passes parity against staging.

## Phase 4 — Async, email, cron

1. Resend + React Email templates; wire OTP/sign-in/invite/revoke/password sends + webhook (`08`).
2. `vercel.json` crons: reconcile-payments, account-lifecycle, expire-cleanup (`10`).
3. Remove reliance on any poll/heartbeat; verify TTL cleanup of `sessions`.

**Exit:** scheduled work runs on cron; emails deliver from a verified domain.

## Phase 5 — Parity validation & cutover

1. **URL strategy:** add a `/v1/* → /api/v1/*` rewrite so existing client URLs work unchanged (recommended — zero client edits). Confirm `/v1/notificationss` handling (`07`).
2. **Parity run:** replay a representative request set against both backends (same Atlas data); diff responses (`13`).
3. **Cutover by traffic:**
   - Point a staging/canary domain at the new backend; smoke-test each client build against it.
   - Flip DNS / Vercel domain for the production API host to the new backend. Because both share the DB, this is reversible.
4. **Admin auth flip:** retire the Auth0 bridge after admins have set local passwords / sessions migrated.
5. **Monitor:** error rates, latency, rate-limit headers, webhook success, cron runs.

**Exit:** production traffic on the new backend; old backend on standby for rollback.

## Phase 6 — Decommission

1. After a stability window, retire the FastAPI app, Celery workers, APScheduler, and Redis broker.
2. Drop superseded `access_tokens`/`refresh_tokens` collections once no old sessions remain.
3. Remove Auth0 tenant dependency.
4. Update `readme.md`, `DOCS_INDEX.md`, `MIGRATION_LOG.md` to reflect the new architecture.

## Rollback

At every phase, the old backend remains deployable and shares the database. Rollback = repoint the API domain to the old backend. The only one-way door is **admin password migration** — keep the Auth0 bridge until that's irreversible-safe.

## Client coordination

| Client | Required change | When |
|--------|-----------------|------|
| Admin web | Switch from Auth0 SDK login to backend `POST /v1/admins/login` + token refresh; store refresh in cookie | Phase 1/5 |
| Customer mobile | None if URL preserved; verify token refresh against new rotation semantics | Phase 5 |
| Cleaner mobile | Same as customer mobile | Phase 5 |

> The mobile apps need no rebuild **if** the URL prefix and contract are preserved and the refresh endpoint keeps its shape. The rotation change is server-side; clients that already store-and-replace the returned refresh token keep working. Apps that cache a refresh token and reuse it without replacing will break — verify this in the client code before cutover (flagged in `15`).

## Cross-references

- Contract inventory: `07` · Auth: `03` · Testing/parity: `13` · Risks: `15`
