# 00 — Migration Overview

> Target: migrate the **Marcus Cleaning** FastAPI backend to a **Next.js (App Router) serverless backend on Vercel**, preserving the layered architecture and the public API contract that one web app and two mobile apps depend on.

This folder is the **architecture + migration specification**. It is documentation only — no application code is produced here. Each file is self-contained and cross-links to the others.

## Reading order

| # | File | What it covers |
|---|------|----------------|
| 00 | `00-overview.md` | Goals, scope, decisions log (this file) |
| 01 | `01-architecture.md` | Layered serverless architecture, source tree, runtime constraints |
| 02 | `02-data-model.md` | MongoDB collections, indexes, TTL, Zod schema strategy |
| 03 | `03-auth.md` | Unified JWT, refresh rotation, OAuth, sessions, client/audience map |
| 04 | `04-api-layer.md` | Hono + zod-openapi conventions, response envelope, middleware, errors |
| 05 | `05-api-docs-scalar.md` | OpenAPI generation + Scalar reference UI |
| 06 | `06-services-and-repositories.md` | Layer contracts + old→new module mapping |
| 07 | `07-domain-endpoints.md` | Full endpoint inventory (old→new), contract-parity rules |
| 08 | `08-email-resend.md` | Resend + React Email, templates, webhooks, idempotency |
| 09 | `09-payments.md` | Provider abstraction, Stripe/Flutterwave webhooks, reconciliation |
| 10 | `10-background-and-cron.md` | Per-task removal plan + `vercel.json` crons |
| 11 | `11-infra-and-env.md` | Vercel config, env-var mapping (old→new), Atlas/Upstash setup |
| 12 | `12-rate-limiting-i18n.md` | Upstash rate limits, en/fr localization |
| 13 | `13-testing-strategy.md` | Vitest, contract tests, parity checks vs old API |
| 14 | `14-migration-plan.md` | Phased cutover, data continuity, client coordination |
| 15 | `15-open-questions-risks.md` | Remaining unknowns + risks |

## Goals

1. **Serverless on Vercel** — no long-running worker processes, no Celery, no APScheduler.
2. **Preserve the API contract** — the existing web/mobile clients must keep working without client rewrites. Request/response shapes, paths, status codes, and the response envelope are frozen unless a deliberate, documented change is made.
3. **Unify and harden auth** — replace the split Auth0(admin)/local(user) model with a single self-issued JWT system designed for 1 web + 2 native mobile clients.
4. **Modern email** — Resend + React Email replacing synchronous SMTP.
5. **First-class API docs** — auto-generated OpenAPI 3.1 rendered by Scalar.
6. **Keep the layered design** — `routes → services → repositories → schemas`, with `security/` and `core/` cross-cutting layers, ported faithfully to TypeScript.

## Non-goals (this cycle)

- No data store change — MongoDB stays (see decision D1). No data migration.
- No frontend/mobile rewrites — clients are coordinated, not rebuilt (see `14`).
- No managed queue — async work is replaced with cron + webhooks + TTL (see `10`). A queue is documented only as a future opt-in.
- No multi-region / sharding work.

## Source system (what we are migrating from)

- **Stack:** Python 3.11 + FastAPI, MongoDB (Motor async), Redis (rate-limit + Celery broker + cache), Celery worker + APScheduler.
- **Size:** ~23k LOC across `api/` (25 route modules), `services/` (40), `repositories/` (29), `schemas/` (33), `tests/` (49).
- **Layers:** `api/` → `services/` → `repositories/` → `schemas/`, plus `security/` (auth/permission) and `core/` (settings, queue, payments, storage, i18n, response envelope, errors).
- **Auth (split):** admin via Auth0; customer/cleaner via local JWT (access + refresh stored in Mongo), with role-based session max-age + idle-timeout, DB-driven permission lists, and a super-admin bypass.
- **Domains:** customers, cleaners, admins (+ rich admin feature set: concierge booking, dynamic pricing, promo codes, service areas, claims, broadcasts, credit ledger, payout adjustments, availability overrides, chat interventions, tags, service/addon catalogs), bookings (state machine), payments (Stripe / Flutterwave / test + webhooks), places (Google Maps), documents (local/S3), reviews, notifications, banners.
- **Background jobs:** `delete_tokens`, `reconcile_pending_payments` (polled), `generate_audit_export`, account-lifecycle processor, APScheduler heartbeat.
- **Conventions:** response envelope `{success, message, data, requestId}`; en/fr i18n; per-role rate limits; `X-Request-ID` / `X-Process-Time` headers.

## Decisions log

| ID | Decision | Rationale | Detail |
|----|----------|-----------|--------|
| D1 | **Keep MongoDB Atlas** | Avoid a full data migration; reuse existing document shapes. Atlas is a native Vercel Marketplace integration. | `02`, `11` |
| D2 | **Hono mounted in Next.js** (`app/api/[[...route]]/route.ts` via `hono/vercel`) | Typed routes + clean layering + single deployable. | `04` |
| D3 | **`@hono/zod-openapi` + Scalar** | Zod schemas drive validation *and* OpenAPI 3.1; Scalar renders the reference UI. | `04`, `05` |
| D4 | **Unified self-issued JWT** (`jose`, HS256, access + rotating refresh w/ reuse detection) | One auth path for all roles; ideal for 2 native mobile + 1 web; drops Auth0 dependency. | `03` |
| D5 | **Vercel Cron + webhooks + Mongo TTL** (no queue) | Removes Celery/APScheduler; provider webhooks become the source of truth; TTL auto-expires tokens. | `10` |
| D6 | **Backend-only Next.js app** | Mirrors current topology — clients consume over HTTP. | `01` |
| D7 | **Client → audience map:** `admin-web`, `customer-mobile`, `cleaner-mobile` | Per-client token audiences; per-client session lengths and CORS. | `03`, `12` |
| D8 | **Resend + React Email** | Resend-native template authoring; previewable `.tsx`. | `08` |
| D9 | **Node.js runtime everywhere** | The MongoDB Node driver requires Node, not Edge. | `01` |
| D10 | **Upstash Redis** for rate-limit/cache | HTTP-based, serverless-safe replacement for Redis. | `12` |
| D11 | **S3 storage provider retained** (Vercel Blob noted as alternative) | Keep the existing provider abstraction and bucket. | `01`, `11` |

## Hard requirement: contract parity

The three clients (admin web, customer mobile, cleaner mobile) are in production against the current API. The migrated backend must reproduce **exact** paths, methods, request/response shapes (including `snake_case`/`camelCase` aliases where they exist today), status codes, and the response envelope. Any intentional divergence must be listed in `07-domain-endpoints.md` under "Deliberate changes" and coordinated per `14-migration-plan.md`.
