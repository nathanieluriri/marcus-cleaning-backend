# 01 — Layered Serverless Architecture

This document defines the target architecture and how the existing six-layer FastAPI design maps onto a Next.js serverless app on Vercel.

## Principles (carried over from the current backend)

The current backend's layering is sound and is preserved verbatim in spirit:

- **Routes** validate request shape, apply auth/permission guards, and **delegate**. They never touch the database.
- **Services** hold business rules, lifecycle transitions, and cross-module orchestration. They never import HTTP/Hono types — they take/return plain data + Zod-inferred models.
- **Repositories** own all MongoDB access and query construction. Nothing outside `repositories/` builds a Mongo query.
- **Schemas** are the single source of truth for request/response contracts and internal models (Zod, with inferred TS types).
- **Security** resolves caller identity (`AuthPrincipal`) and enforces permission/account-status checks.
- **Core** is cross-cutting infrastructure: settings, Mongo client, response envelope, errors, i18n, rate-limiting, payments, storage, email, and the OpenAPI/Scalar wiring.

> Why keep strict layers on serverless? Cold-start cost is dominated by module init, not by having more files. Clean boundaries keep handlers small, testable, and independently deployable-in-thought. Services with no HTTP dependency are trivial to unit-test and to invoke from cron handlers.

## Runtime constraints (Vercel)

- **Node.js runtime, always.** The official MongoDB Node driver uses native TCP sockets and Node `crypto`; it does not run on the Edge runtime. Every route handler that reaches Mongo (effectively all of them) runs on Node. Do **not** set `export const runtime = 'edge'`.
- **Fluid Compute** is the default. Instances stay warm and handle concurrent invocations — this is exactly what lets a module-global `MongoClient` reuse its connection pool across requests (see `02`).
- **`maxDuration`** is set once per route segment. With the single catch-all entry, it applies to the whole Hono app. Raise it for heavy endpoints (e.g. audit export). For genuinely long work, split the route segment or fan out (see `10`).
- **No background threads / no long-lived processes.** Anything that was a Celery task or APScheduler job becomes a cron-triggered handler, a webhook handler, or a TTL index (see `10`).

## Source tree

```
marcus-backend/
  src/
    app/
      api/
        [[...route]]/route.ts        # Hono entry — exports GET/POST/PUT/PATCH/DELETE/OPTIONS
                                      # export const runtime = 'nodejs'; export const maxDuration = 60
      web/                            # (optional) payment preview pages, if kept as Next pages
    server/
      app.ts                         # builds the OpenAPIHono instance, mounts middleware + routers + docs
      routes/                        # one module per domain (was api/v1/*.py)
        customers.ts
        cleaners.ts
        admins/                      # admin + admin-features sub-routers (was api/v1/admin_route.py + admin_features/)
          index.ts
          pricing-rules.ts
          promo-codes.ts
          ...                        # one per admin feature
        bookings.ts
        payments.ts
        places.ts
        documents.ts
        reviews.ts
        notifications.ts
        banners.ts
        health.ts
        cron.ts                      # cron-triggered handlers (secured by CRON_SECRET)
      services/                      # business logic (was services/*.py)
      repositories/                  # Mongo access (was repositories/*.py)
      schemas/                       # Zod schemas + inferred types (was schemas/*.py)
      security/                      # JWT verify, principal, role/permission guards (was security/*.py)
      core/
        settings.ts                  # env parsing/validation via Zod (was core/settings.py)
        mongo.ts                     # cached MongoClient (was core/database.py)
        envelope.ts                  # response envelope helpers (was core/response_envelope.py)
        errors.ts                    # typed app errors → envelope (was core/errors.py)
        i18n.ts                      # en/fr message catalog + resolution (was core/i18n.py)
        rate-limit.ts                # Upstash limiter (was Redis limiter in main.py)
        openapi.ts                   # doc config + Scalar mount (new — replaces Swagger/ReDoc)
        request-context.ts           # request-id + timing middleware (was middleware in main.py)
        payments/                    # provider abstraction (was core/payments/)
          manager.ts  provider.ts  stripe.ts  flutterwave.ts  test.ts  types.ts
        storage/                     # S3/local provider (was core/storage/)
          manager.ts  provider.ts  s3.ts  local.ts  types.ts
        email/                       # Resend client + send helpers (was services/email_service.py)
          resend.ts  send.ts
    emails/                          # React Email .tsx components (was email_templates/*.py)
      otp.tsx  new-sign-in.tsx  invitation.tsx  revoke.tsx  password-reset.tsx
  tests/                             # Vitest (was tests/*.py)
  vercel.json                        # cron declarations
  package.json  tsconfig.json
```

## Request lifecycle

```
Client (web/mobile)
  → Vercel Function (Node runtime)
    → app/api/[[...route]]/route.ts  →  handle(app)
      → Hono middleware chain:
          requestId()                       # X-Request-Id in/out
          timing()                          # X-Process-Time
          cors()                            # per-client origin allow-list
          locale()                          # Accept-Language → en/fr
          rateLimit()                       # Upstash, per role
          auth() (route-scoped)             # verify JWT → c.set('principal')
          permissionGuard() (route-scoped)  # role + permissionList + account status
      → route handler (validate via zod-openapi) 
        → service (business logic)
          → repository (Mongo)
      → envelope.ok(data) / envelope.fail(...)   # {success, message, data, requestId}
```

## Entry point (catch-all handler)

```ts
// src/app/api/[[...route]]/route.ts
import { handle } from 'hono/vercel'
import { app } from '@/server/app'

export const runtime = 'nodejs'   // REQUIRED for the Mongo driver — never 'edge'
export const maxDuration = 60     // raise for heavy endpoints; see 10-background-and-cron

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
export const OPTIONS = handle(app)
```

> If a single endpoint needs a much higher `maxDuration` than the rest (e.g. streaming a large audit export), give it its **own** route segment file (e.g. `app/api/admin/audit-export/route.ts`) with its own `maxDuration`, since `maxDuration` cannot be set per-Hono-route within one catch-all.

## What does NOT carry over

| Removed | Replacement | Where |
|---------|-------------|-------|
| Uvicorn/Gunicorn server | Vercel Functions | — |
| Celery worker + broker | Vercel Cron + webhooks + TTL | `10` |
| APScheduler + heartbeat | Vercel Cron + platform monitoring | `10` |
| Redis (broker/cache/rate-limit) | Upstash Redis (rate-limit/cache only) | `12` |
| Auth0 admin integration | Unified self-issued JWT | `03` |
| SMTP (`smtplib`) | Resend | `08` |
| Swagger UI / ReDoc | Scalar (OpenAPI 3.1) | `05` |
| Pydantic | Zod (+ inferred types) | `02`, `04` |
| Motor | MongoDB Node driver | `02` |

## Cross-references

- Data + Mongo client: `02-data-model.md`
- Auth + principal + guards: `03-auth.md`
- Hono conventions + envelope + errors: `04-api-layer.md`
- Env + Vercel config: `11-infra-and-env.md`
