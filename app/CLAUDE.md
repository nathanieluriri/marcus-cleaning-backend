@AGENTS.md

# Project: Marcus Cleaning Backend (Next.js serverless)

This is the TypeScript/Next.js serverless rewrite of the Python FastAPI backend.
The full migration specification lives in `../docs/migration/` (files `00`–`15`).
Treat those docs as the source of truth for architecture, endpoints, and contracts.

## Commit policy (non-negotiable)

- **NEVER add Claude / Anthropic as a commit co-author.** Do not append
  `Co-Authored-By: Claude ...` (or any Claude/Anthropic trailer) to commit messages.
  Do not mention Claude as an author anywhere in commit metadata.
- Do not add "Generated with Claude Code" lines to commits or PR bodies.
- Only commit or push when explicitly asked.
- Never use `--no-verify` or skip hooks unless explicitly told to.

## Stack & conventions

- **Next.js 16** (App Router, root-level `app/`). This version has breaking changes —
  read `node_modules/next/dist/docs/` before using a Next API. See `AGENTS.md`.
- **Hono** mounted as a single catch-all route at `app/api/[[...route]]/route.ts`
  via `hono/vercel` `handle()`. Runtime is **Node.js** (never Edge — the MongoDB
  driver requires Node). See `../docs/migration/01-architecture.md`.
- **`@hono/zod-openapi`** for typed routes → OpenAPI 3.1, rendered by **Scalar**
  at `/api/reference`. See `../docs/migration/05-api-docs-scalar.md`.
- **MongoDB** via the official `mongodb` driver with a module-cached client.
  Never re-instantiate the client per request. See `../docs/migration/02-data-model.md`.
- **Auth**: unified self-issued JWT (`jose`, HS256) — access + rotating refresh with
  reuse detection. See `../docs/migration/03-auth.md`.
- **Email**: Resend + React Email. **Async work**: Vercel Cron + webhooks + Mongo TTL
  (no Celery/queue). **Rate-limit/cache**: Upstash Redis.
- Path alias: `@/*` → repo `app/` root (see `tsconfig.json`).

## Layering (strict)

`routes → services → repositories → schemas`, plus cross-cutting `security/` and `core/`.

- **Routes** validate + delegate. No DB access in routes.
- **Services** hold business logic. No Hono/HTTP types in services (so cron + tests can reuse them).
- **Repositories** own all Mongo access. Only place that builds queries / imports `mongodb`.
- **Schemas** are Zod (request/response/internal) with inferred TS types.

## Contract parity

The existing web + two mobile clients depend on the current API. Preserve exact paths,
methods, request/response shapes (including snake/camel aliases), status codes, and the
response envelope `{ success, message, data, requestId }`. Intentional changes must be
recorded in `../docs/migration/07-domain-endpoints.md` ("Deliberate changes").

## Verify before claiming done

- `npm run typecheck` (or `tsc --noEmit`) and `npm run lint` must pass.
- Run `npm test` (Vitest) for touched areas.
