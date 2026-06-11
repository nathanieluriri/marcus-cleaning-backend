# 07 — Domain Endpoint Inventory & Contract Parity

This is the authoritative endpoint inventory extracted from the current routers. **Every path, method, and contract here must be reproduced exactly** by the migrated backend (the hard requirement from `00`).

## Mount conventions

- Current FastAPI mounts routers under `/v1`. The Next.js app mounts the Hono app under `/api`, so paths become `/api/v1/...`.
- **Parity rule:** if the existing clients call `/v1/...` (no `/api`), preserve that by **either** (a) mounting Hono with no `/api` segment (use `app/api/...` internally but rewrite via `next.config` / `vercel.json` so `/v1/*` resolves), **or** (b) coordinating clients to add `/api`. Decide in `14`; default recommendation is to keep client URLs unchanged via a rewrite so **no client edits are required**. This file lists the logical paths after the `/v1` prefix.
- Admin feature routers are nested **inside** `/v1/admins` (current code includes them in `admin_route` with an admin guard). So e.g. `/v1/admins/pricing-rules`.

Legend: 🔒 = authenticated; 🌐 = public; ⚙️ = hidden from OpenAPI; ⏰ = cron/webhook (see `10`).

---

## `/v1/customers` (customer-route)

| Method | Path | Auth | Service |
|--------|------|------|---------|
| GET | `/google/auth` | 🌐 | OAuth start (`03`) |
| GET | `/auth/callback` | 🌐 | OAuth callback (`03`) |
| PATCH | `/me` | 🔒 customer | profile update |
| POST | `/signup` | 🌐 | signup |
| POST | `/login` | 🌐 | login |
| POST | `/refresh` | 🔒 refresh | token refresh (rotation) |
| DELETE | `/account` | 🔒 customer | delete account |
| GET | `/me/addresses` | 🔒 | list addresses |
| POST | `/me/addresses` | 🔒 | create (takes `place_id`, server-resolves) |
| PATCH | `/me/addresses/{address_id}` | 🔒 | update |
| DELETE | `/me/addresses/{address_id}` | 🔒 | delete |
| POST | `/me/addresses/{address_id}/set-default` | 🔒 | set default |
| GET | `/me/language` | 🔒 | get preferred language |
| PATCH | `/me/language` | 🔒 | set preferred language |
| POST | `/sign-in` | 🌐 | contract alias of login |
| POST | `/sign-up` | 🌐 | contract alias of signup |
| POST | `/password-reset/request` | 🌐 | request reset email |
| GET | `/home` | 🔒 | customer-app home |
| GET | `/bookings/services/{service_id}/extras` | 🔒 | service extras |
| GET | `/bookings/cleaners` | 🔒 | bookable cleaners list |
| GET | `/bookings/cleaners/{cleaner_id}` | 🔒 | cleaner detail |
| GET | `/bookings/cleaners/{cleaner_id}/reviews` | 🔒 | cleaner reviews |
| POST | `/bookings/create` | 🔒 | customer-app create-booking alias |
| GET | `/notifications` | 🔒 | list notifications |
| POST | `/notifications/{notification_id}/read` | 🔒 | mark read |
| POST | `/notifications/read-all` | 🔒 | mark all read |
| DELETE | `/notifications/{notification_id}` | 🔒 | delete |
| GET | `/settings` | 🔒 | get settings |
| PATCH | `/settings/notifications` | 🔒 | notification prefs |
| PATCH | `/settings/security` | 🔒 | security prefs |
| POST | `/settings/sessions/revoke-others` | 🔒 | session control (`03`) |
| POST | `/settings/sessions/revoke-all` | 🔒 | session control |
| POST | `/settings/sessions/logout` | 🔒 | logout current |
| POST | `/settings/account/deactivate` | 🔒 | deactivate |
| POST | `/settings/account/delete` | 🔒 | delete (lifecycle) |
| DELETE | `/settings/account` | 🔒 | delete (alias) |
| DELETE | `/settings/security/sessions/{session_id}` | 🔒 | targeted session revoke |
| PATCH | `/settings/privacy` | 🔒 | privacy prefs |
| GET | `/profile/me` | 🔒 | profile alias |
| PATCH | `/profile/me` | 🔒 | profile update alias |
| GET | `/profile/addresses` | 🔒 | addresses alias |
| POST | `/profile/addresses` | 🔒 | |
| PATCH | `/profile/addresses/{address_id}` | 🔒 | |
| DELETE | `/profile/addresses/{address_id}` | 🔒 | |
| GET | `/profile/payment-methods` | 🔒 | payment methods alias |
| POST | `/profile/payment-methods` | 🔒 | |
| PATCH | `/profile/payment-methods/{payment_method_id}` | 🔒 | |
| DELETE | `/profile/payment-methods/{payment_method_id}` | 🔒 | |

> Note the **two route groups** in the current code: `router` (mounted) and `customer_app_router` (mounted separately, the contract aliases like `/sign-in`, `/home`, `/bookings/*`). Reproduce both under `/v1/customers`.

---

## `/v1/cleaners` (cleaner-route)

| Method | Path | Auth |
|--------|------|------|
| GET | `/google/auth` | 🌐 |
| GET | `/auth/callback` | 🌐 |
| POST | `/signup` | 🌐 |
| POST | `/login` | 🌐 |
| POST | `/refresh` | 🔒 refresh |
| PUT | `/onboarding` | 🔒 cleaner |
| DELETE | `/account` | 🔒 cleaner |
| POST | `/sessions/revoke-others` | 🔒 |
| POST | `/sessions/revoke-all` | 🔒 |
| POST | `/sessions/logout` | 🔒 |
| GET | `/me/language` | 🔒 |
| PATCH | `/me/language` | 🔒 |

---

## `/v1/admins` (admin-route + nested admin-features, all 🔒 admin)

### Core admin
| Method | Path |
|--------|------|
| GET | `/profile` |
| GET / PATCH | `/profile/language` |
| POST | `/access/request-elevation` |
| GET | `/access/request-elevation/status` |
| GET / POST | `/access/permission-groups` |
| GET | `/access/requests` |
| PATCH | `/access/requests/{request_id}/decision` |
| GET / PUT | `/permission-templates/{role}` |
| POST | `/permission-templates/{role}/rollout` |
| POST | `/permission-templates/{role}/preview` |
| GET | `/permission-templates/{role}/rollout-impact` |
| GET | `/permissions/catalog` |
| PATCH | `/cleaners/{cleaner_id}/onboarding-review` |
| GET | `/customers` |
| GET | `/customers/{customer_id}` |
| GET | `/customers/{customer_id}/places` |
| POST | `/customers/{customer_id}/places` |
| GET | `/cleaners` |
| GET | `/onboarding/queue` |
| GET | `/cleaners/{cleaner_id}` |
| GET | `/users/autocomplete` |
| POST | `/signup` |
| POST | `/login` |
| POST | `/sessions/revoke-others` |
| POST | `/sessions/revoke-all` |
| POST | `/sessions/logout` |
| DELETE | `/account` |
| DELETE | `/{admin_id}` |

### Monitoring & reporting
| Method | Path |
|--------|------|
| GET | `/monitoring/overview` |
| GET | `/monitoring/auth/heatmap` |
| GET | `/monitoring/permissions/denied-top` |
| GET | `/monitoring/sessions/anomalies` |
| GET | `/monitoring/alerts/sla` |
| GET | `/monitoring/alerts` |
| PATCH | `/monitoring/alerts/{alert_id}/read` |
| PATCH | `/monitoring/alerts/{alert_id}/ack` |
| POST | `/monitoring/audit/export` |
| GET | `/monitoring/audit/export/{export_id}` |
| GET | `/monitoring/audit/export/{export_id}/download` |
| GET | `/monitoring/audit/history` |
| GET | `/monitoring/audit/history/{event_id}` |
| GET | `/reports/users/summary` |
| GET | `/reports/users/signups-trend` |

> **Audit export change:** today export is enqueued to Celery and polled via `/export/{id}`. Target: generate **synchronously on-demand** (streamed) on a route with a raised `maxDuration`, or keep the create→poll→download shape but back it with a cron sweep (`10`). The **create/status/download endpoints stay** for client parity; their internals change.

### Admin feature sub-routers (nested under `/v1/admins`)
Each is standard CRUD (`GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`) unless extra rows are noted.

| Mount | Extra endpoints |
|-------|-----------------|
| `/service-definitions` | — |
| `/add-ons` | — |
| `/pricing-rules` | — |
| `/service-areas` | — |
| `/cleaner-tags` | — |
| `/availability-overrides` | — |
| `/promo-codes` | — |
| `/service-credits` | `POST /grant`, `GET /balance/{customer_id}` |
| `/payout-adjustments` | — |
| `/chat-interventions` | — |
| `/broadcasts` | `POST /dispatch` |
| `/concierge-bookings` | `POST /create-booking` |
| `/claim-reviews` | `POST /{id}/decision` |

---

## `/v1/bookings` (booking-route)

| Method | Path | Auth |
|--------|------|------|
| POST | `/` | 🔒 customer (customer id token-derived) |
| GET | `/` | 🔒 booking principal (customer/cleaner) |
| GET | `/{booking_id}` | 🔒 visibility-checked |
| POST | `/{booking_id}/accept` | 🔒 cleaner |
| POST | `/{booking_id}/complete` | 🔒 cleaner |
| POST | `/{booking_id}/acknowledge` | 🔒 customer |
| POST | `/{booking_id}/payments/mark-paid` | 🔒 customer |
| PATCH | `/{booking_id}/payments/mark-paid` | 🔒 customer (alias) |
| POST | `/{booking_id}/ratings` | 🔒 customer |

**Query-param aliases on `GET /`** (must be preserved exactly): `status`, `scope`, `payment_status` **and** `paymentStatus`, `cursor`, `page_size` **and** `pageSize`, `scheduled_sort` **and** `scheduledSort`, and `sort` accepting `scheduledAt_asc`/`scheduledAt_desc`. Reproduce this dual snake/camel acceptance in the Zod query schema.

---

## `/v1/payments` (payments-route)

| Method | Path | Auth |
|--------|------|------|
| POST | `/webhooks/{provider}` | ⏰ webhook (signature-verified, `09`) |
| GET | `/methods` | 🔒 customer |
| POST | `/methods` | 🔒 |
| PATCH | `/methods/{method_id}` | 🔒 |
| DELETE | `/methods/{method_id}` | 🔒 |
| POST | `/methods/{method_id}/set-default` | 🔒 |
| GET | `/{payment_id}` | 🔒 |
| GET | `/reference/{reference}` | 🔒 |
| POST | `/{payment_id}/refund` | 🔒 |
| POST | `/{payment_id}/reconcile` | 🔒 (manual reconcile; also driven by cron, `10`) |

---

## `/v1/places` (place-route)

| Method | Path | Auth |
|--------|------|------|
| GET | `/allowed-countries` | 🌐/🔒 |
| GET | `/autocomplete` | 🔒 |
| GET | `/details` | 🔒 |
| POST | `/search-results` | 🔒 |
| GET | `/search-results` | 🔒 |
| GET | `/search-history` | 🔒 |
| GET | `/reverse-geocode` | 🔒 |

---

## `/v1/documents` (documents-route)

| Method | Path | Auth |
|--------|------|------|
| POST | `/upload-intents` | 🔒 |
| POST | `/complete` | 🔒 |
| GET | `/{document_id}` | 🔒 |
| DELETE | `/{document_id}` | 🔒 |
| POST | `/upload-local/{object_key}` | ⚙️ (local backend helper) |
| GET | `/local/{object_key}` | ⚙️ (local backend helper) |

> The local upload/read helpers exist for the `local` storage backend. On Vercel use S3 (or Vercel Blob) so these become no-ops/dev-only; keep them ⚙️ hidden. See `11`.

---

## `/v1/reviews`, `/v1/banners`, `/v1/notificationss`

Standard CRUD (`GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`).

> ⚠️ **Preserve the existing path spelling** `/v1/notificationss` (double "s") if clients depend on it — it appears to be the current mount prefix. Confirm in `14` whether to keep verbatim or fix-with-redirect (this is the one likely-bug worth raising with the team). The customer-app notifications live under `/v1/customers/notifications` (above) and are the primary client surface.

---

## `/web/payments` (web payment template pages — ⚙️ hidden)

| Method | Path |
|--------|------|
| GET | `/web/payments/template` |
| GET | `/web/payments/link/{reference}` |

These render HTML (Jinja today). Options: port to a Next.js page/route returning HTML, or a Hono handler returning the rendered template. Keep static assets (`payment-template.css/js`) under `public/`. See `09`.

---

## Health

| Method | Path |
|--------|------|
| GET | `/` (root, ⚙️) |
| GET | `/health` |

`/health` reports Mongo + (Upstash) Redis status. The APScheduler heartbeat check is **removed** (no scheduler). Add a check that the cron last-run marker is fresh if you want equivalent cron observability (`10`).

---

## Deliberate changes (must be coordinated, see `14`)

1. **URL prefix** — keep `/v1/*` via rewrite (recommended, zero client change) **or** move to `/api/v1/*`.
2. **Audit export internals** — same endpoints, synchronous/cron-backed generation instead of Celery.
3. **`/docs` → `/api/reference`** redirect (Scalar replaces Swagger).
4. **`/v1/notificationss`** spelling — keep verbatim or correct with redirect (team decision).
5. **Auth tokens** — token *format* changes (now our JWT for all roles) but the login/refresh request/response *shapes* are preserved; admin clients that talked to Auth0 directly must switch to backend login (`03`, `14`).

## Cross-references

- Auth flows: `03-auth.md` · Payments/webhooks: `09-payments.md` · Cron/webhooks: `10-background-and-cron.md` · Parity tests: `13-testing-strategy.md`
