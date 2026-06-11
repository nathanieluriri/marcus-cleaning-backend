# 02 — Data Model (MongoDB) & Schema Strategy

Decision **D1**: MongoDB Atlas is retained. **No data migration.** Existing collections and document shapes are reused as-is; we add a few new collections to support unified auth.

## MongoDB client (serverless-safe)

The single most important serverless detail: **cache the `MongoClient` at module scope** so the connection pool survives across warm invocations. Re-instantiating per request exhausts Atlas connection limits.

```ts
// src/server/core/mongo.ts
import { MongoClient, ServerApiVersion, type Db } from 'mongodb'
import { settings } from './settings'

const uri = settings.MONGODB_URI
const options = {
  appName: 'marcus-backend',
  maxPoolSize: 10,            // serverless: keep small (driver default 100 is too high)
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  serverApi: { version: ServerApiVersion.v1 },
}

let client: MongoClient

if (process.env.NODE_ENV === 'development') {
  // Preserve the client across HMR reloads in dev.
  const g = global as typeof globalThis & { _mongoClient?: MongoClient }
  if (!g._mongoClient) g._mongoClient = new MongoClient(uri, options)
  client = g._mongoClient
} else {
  client = new MongoClient(uri, options)
}

export function getDb(): Db {
  return client.db(settings.DB_NAME)
}
export { client }
```

Notes:
- The driver lazily connects on first operation; no explicit `connect()` needed, but calling it once is fine.
- Node.js runtime only (see `01`).
- Atlas + Vercel is a first-party Marketplace integration; it injects `MONGODB_URI` and adds Vercel's dynamic egress to the Atlas IP allow-list (`0.0.0.0/0`). See `11`.

## Index creation strategy

The current code lazily ensures indexes inside repositories (e.g. `_ensure_booking_indexes` with a module flag). That pattern works but fires a guard on every cold start. Recommended target:

- Keep a small idempotent `ensureIndexes()` per repository, **but** invoke them from a single **one-time setup script** (`scripts/ensure-indexes.ts`) run at deploy time (or a manual/seed step), not on the hot path.
- `createIndex` is idempotent, so re-running is safe.

Each repository documents the indexes it requires (mirroring the existing `create_index` calls).

## Zod schema strategy (replacing Pydantic)

- Each domain has a `schemas/<domain>.ts` exporting Zod objects for **request** bodies/queries/params and **output** shapes, plus inferred types: `export type BookingOut = z.infer<typeof BookingOut>`.
- Schemas use `@hono/zod-openapi`'s `z` so they double as OpenAPI definitions (`.openapi('Name')`, `.openapi({ example })`). See `04`.
- **Mongo `_id` handling:** repositories convert `ObjectId` ↔ string at the boundary. Output schemas expose `id: string` (matching today's behavior where `BookingOut(**row)` maps `_id`). A shared helper normalizes documents:

```ts
// src/server/repositories/_helpers.ts
import { ObjectId } from 'mongodb'
export const toId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : (id as unknown as ObjectId))
export const fromDoc = <T extends { _id?: unknown }>(doc: T) => {
  const { _id, ...rest } = doc as Record<string, unknown>
  return { id: String(_id), ...rest }
}
```

- **camelCase/snake_case parity:** the current API mixes conventions (e.g. booking list query accepts both `payment_status` and `paymentStatus`, `page_size` and `pageSize`). Zod schemas reproduce these aliases exactly using `.transform`/multiple optional fields, so clients are unaffected (see `07`).

## Collections inventory

Derived from the repositories. Names are the current Mongo collection names (preserve them).

### Identity & auth

| Collection | Source repo | Purpose | Key indexes |
|------------|-------------|---------|-------------|
| `customers` | `customer_repo` | Customer accounts | `email` (unique), `accountStatus` |
| `cleaners` | `cleaner_repo` | Cleaner accounts + onboarding status | `email` (unique), onboarding status |
| `admins` | `admin_repo` | Admin accounts + permissions | `email` (unique) |
| `access_tokens` / `refresh_tokens` | `tokens_repo` | **Replaced** by new `sessions` model (see below + `03`) | — |
| `role_permission_templates` | `role_permission_template_repo` | Per-role permission templates + rollout | `role` |

### New collections for unified auth (see `03`)

| Collection | Purpose | Key indexes |
|------------|---------|-------------|
| `sessions` | Refresh-token families (one per login/device). Stores `sha256` of refresh token, never plaintext. | `tokenHash` (unique), `userId`, `sessionId`, **TTL on `expiresAt`** |
| `oauth_states` | Short-lived Google OAuth `state` + PKCE verifier | **TTL on `expiresAt`** (~10 min) |

> The old `access_tokens`/`refresh_tokens` collections are superseded. During migration they can be left in place (read-compat) or dropped after cutover — see `14`.

### Booking & service domain

| Collection | Source repo | Notes |
|------------|-------------|-------|
| `bookings` | `booking_repo` | State machine; indexes on `customer_id`, `cleaner_id`, `status`, `schedule`, `place_id`, unique sparse `payment_id` |
| `service_definitions` | `service_definition` | Admin-managed services |
| `addon_catalog` | `addon_catalog` | Add-ons / extras |
| `dynamic_pricing_rule` | `dynamic_pricing_rule` | Pricing rules |
| `promo_code` | `promo_code` | Promo codes |
| `service_area_boundary` | `service_area_boundary` | Geographic service areas |
| `availability_override` | `availability_override` | Cleaner availability overrides |
| `cleaner_skill_equipment_tag` | `cleaner_skill_equipment_tag` | Tags |
| `service_credit_ledger` | `service_credit_ledger` | Customer credit ledger + balances |
| `payout_adjustment` | `payout_adjustment` | Cleaner payout adjustments |

### Payments

| Collection | Source repo | Notes |
|------------|-------------|-------|
| `payments` | `payment_repo` | Payment transactions (status, reference, provider) |
| `payment_methods` | `payment_method_repo` | Saved payment methods |

### Places & addresses

| Collection | Source repo | Notes |
|------------|-------------|-------|
| `saved_addresses` | `saved_address_repo` | Customer saved addresses (store `place_id`, server-resolve details) |
| `autocomplete_search_result` | `autocomplete_search_result` | Cached place search history |

### Content, ops & admin monitoring

| Collection | Source repo | Notes |
|------------|-------------|-------|
| `reviews` | `review` | Booking/cleaner reviews |
| `notifications` | `notifications` | User notifications |
| `banner` | `banner` | Home banners |
| `documents` | `document_repo` | Document upload metadata |
| `concierge_booking` | `concierge_booking` | Admin concierge bookings |
| `claim_review` | `claim_review` | Claims + decisions |
| `chat_intervention` | `chat_intervention` | Admin chat interventions |
| `system_broadcast` | `system_broadcast` | Broadcasts + dispatch |
| `admin_monitoring` / audit | `admin_monitoring_repo` | Audit events, exports, SLA alerts |

> This table is a map, not a schema dump. The authoritative field-level shapes come from porting each `schemas/*.py` Pydantic model to a Zod schema 1:1. `06` lists the per-domain service/repo mapping; `13` defines parity tests that lock field shapes.

## TTL indexes (replace cleanup jobs)

| Collection | TTL field | Effect |
|------------|-----------|--------|
| `sessions` | `expiresAt` (BSON Date) | Auto-deletes expired refresh sessions — replaces the `delete_tokens` job (see `10`) |
| `oauth_states` | `expiresAt` | Auto-deletes stale OAuth handshakes |

```ts
await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```

Caveats (important): TTL sweeps run roughly every 60s and are eventual — **always re-check `expiresAt`/`revokedAt` at validation time** (see `03`). The field must be a BSON `Date`. Set `expiresAt` slightly past nominal expiry so revoked/used tokens linger long enough for reuse detection.

## Cross-references

- Auth collections detail: `03-auth.md`
- Per-domain old→new mapping: `06-services-and-repositories.md`
- Field-shape parity tests: `13-testing-strategy.md`
