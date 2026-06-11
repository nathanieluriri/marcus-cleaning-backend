# 06 — Services & Repositories (Layer Contracts + Old→New Mapping)

This document defines the contracts for the service and repository layers in TypeScript and maps every current Python module to its target.

## Layer contracts

### Repository layer

- One file per collection/domain under `src/server/repositories/`.
- Exports plain async functions: `getById`, `find`, `insert`, `update`, `delete`, plus domain-specific queries.
- **Only place** that imports `mongodb` / builds queries / touches `getDb()`.
- Converts `ObjectId ↔ string` at the boundary (`_helpers.ts`, see `02`) and parses documents through the domain's **output** Zod schema before returning, so callers always get validated, typed objects.
- Owns its index definitions (documented + created by the deploy-time `ensureIndexes` step).

```ts
// shape of a repository function
export async function getBookingById(id: string): Promise<BookingOut | null> {
  const row = await getDb().collection('bookings').findOne(idFilter(id))
  return row ? BookingOut.parse(fromDoc(row)) : null
}
```

### Service layer

- One file per domain under `src/server/services/`.
- Pure business logic: lifecycle transitions, orchestration across repositories, pricing, permission-derived decisions.
- **No Hono / HTTP types.** Inputs are `{ principal, payload, ... }`; outputs are domain models or throw typed `AppError`s.
- Calls repositories, the payment/storage/email managers, and other services. Never builds Mongo queries directly.
- Cron handlers and route handlers both call services — keep them HTTP-agnostic so cron reuse is free.

```ts
// shape of a service function
export async function createBookingForCustomer(args: { principal: AuthPrincipal; payload: BookingCustomerCreateRequest }): Promise<BookingOut> { ... }
```

### Why this discipline matters on serverless

A service with no HTTP dependency can be invoked from a route handler, a cron handler, or a test with identical inputs. The booking state machine, pricing, and reconciliation logic are exercised by both `/v1/bookings/*` routes and the daily reconciliation cron — they must not know which caller they have.

## Module mapping — services

| Current (`services/*.py`) | Target (`server/services/*.ts`) | Notes |
|---|---|---|
| `auth_identity_service` | `auth-identity-service` | Folds into unified JWT identity resolution (`03`); Auth0-claim resolution removed |
| `auth_session_service` | `auth-session-service` | Refresh families, rotation, reuse detection (`03`) |
| `auth_helpers` | `auth-helpers` | Hashing/token helpers; bcrypt → `bcrypt`/`argon2` for passwords, `jose` for JWT |
| `super_admin_identity_service` | `super-admin-identity-service` | Static super-admin bypass preserved |
| `role_account_gateway` | `role-account-gateway` | `retrieveAccountById(role, id)` across customers/cleaners/admins |
| `customer_service` | `customer-service` | Signup/login/profile/settings/account lifecycle |
| `customer_app_contract_service` | `customer-app-contract-service` | Customer-app contract endpoints + `process_due_account_lifecycle_jobs` → cron (`10`) |
| `cleaner_service` | `cleaner-service` | Signup/login/onboarding |
| `admin_service` | `admin-service` | Admin auth/profile, directory, permission templates, elevation |
| `admin_monitoring_service` | `admin-monitoring-service` | Overview, heatmap, anomalies, alerts, **audit export** (now on-demand, `10`) |
| `admin_reporting_service` | `admin-reporting-service` | User summary / signups-trend reports |
| `permission_catalog_service` | `permission-catalog-service` | Permission catalog/groups |
| `role_permission_template_service` | `role-permission-template-service` | Templates + rollout + preview + impact |
| `booking_service` | `booking-service` | Create/list/get/accept/complete/acknowledge/mark-paid/rate |
| `booking_state_machine` | `booking-state-machine` | System-owned status transitions |
| `booking_contract_mapping_service` | `booking-contract-mapping-service` | Maps booking ↔ customer-app contract shapes |
| `concierge_booking_service` | `concierge-booking-service` | Admin concierge create-booking flow |
| `payment_service` | `payment-service` | Create/refund/reconcile; webhook processing |
| `pricing_service` | `pricing-service` | Pricing computation |
| `dynamic_pricing_rule_service` | `dynamic-pricing-rule-service` | Pricing rule CRUD |
| `promo_code_service` | `promo-code-service` | Promo code CRUD/validation |
| `service_definition_service` | `service-definition-service` | Services CRUD |
| `addon_catalog_service` | `addon-catalog-service` | Add-ons CRUD |
| `service_area_boundary_service` | `service-area-boundary-service` | Service areas CRUD |
| `availability_override_service` | `availability-override-service` | Availability overrides CRUD |
| `cleaner_skill_equipment_tag_service` | `cleaner-skill-equipment-tag-service` | Tags CRUD |
| `service_credit_ledger_service` | `service-credit-ledger-service` | Credits + grant + balance |
| `payout_adjustment_service` | `payout-adjustment-service` | Payout adjustments CRUD |
| `claim_review_service` | `claim-review-service` | Claims + decision |
| `chat_intervention_service` | `chat-intervention-service` | Chat interventions CRUD |
| `system_broadcast_service` | `system-broadcast-service` | Broadcasts + dispatch (enqueue → direct/ cron, `10`) |
| `place_service` | `place-service` | Google Maps client (httpx → `fetch`/undici); see lifecycle note below |
| `autocomplete_search_result_service` | `autocomplete-search-result-service` | Search history |
| `saved_address_service` | `saved-address-service` | Saved addresses (place_id → resolve) |
| `document_service` | `document-service` | Upload intents + completion (S3/local) |
| `review_service` | `review-service` | Reviews CRUD + access |
| `notifications_service` | `notifications-service` | Notifications |
| `banner_service` | `banner-service` | Banners |
| `email_service` | `core/email/send` | SMTP → Resend + React Email (`08`) |

> **Places HTTP client lifecycle:** the current app initializes/destroys a shared httpx client at FastAPI lifespan (`initialize_places_http_client`/`shutdown_places_http_client`). On serverless there is no lifespan; use a module-global `fetch`/undici agent (reused across warm invocations) and rely on Node's keep-alive. No explicit shutdown.

## Module mapping — repositories

| Current (`repositories/*.py`) | Target (`server/repositories/*.ts`) |
|---|---|
| `customer_repo` | `customer-repo` |
| `cleaner_repo` | `cleaner-repo` |
| `admin_repo` | `admin-repo` |
| `admin_monitoring_repo` | `admin-monitoring-repo` |
| `tokens_repo` | **replaced** by `session-repo` (refresh families, `03`) |
| `role_permission_template_repo` | `role-permission-template-repo` |
| `booking_repo` | `booking-repo` |
| `payment_repo` | `payment-repo` |
| `payment_method_repo` | `payment-method-repo` |
| `saved_address_repo` | `saved-address-repo` |
| `autocomplete_search_result` | `autocomplete-search-result-repo` |
| `document_repo` | `document-repo` |
| `review` | `review-repo` |
| `notifications` | `notifications-repo` |
| `banner` | `banner-repo` |
| `service_definition` | `service-definition-repo` |
| `addon_catalog` | `addon-catalog-repo` |
| `dynamic_pricing_rule` | `dynamic-pricing-rule-repo` |
| `promo_code` | `promo-code-repo` |
| `service_area_boundary` | `service-area-boundary-repo` |
| `availability_override` | `availability-override-repo` |
| `cleaner_skill_equipment_tag` | `cleaner-skill-equipment-tag-repo` |
| `service_credit_ledger` | `service-credit-ledger-repo` |
| `payout_adjustment` | `payout-adjustment-repo` |
| `claim_review` | `claim-review-repo` |
| `chat_intervention` | `chat-intervention-repo` |
| `concierge_booking` | `concierge-booking-repo` |
| `system_broadcast` | `system-broadcast-repo` |

## Module mapping — security & core

| Current | Target | Notes |
|---|---|---|
| `security/auth.py` | `security/guards.ts` + `security/verify.ts` | Single JWT path (`03`/`04`) |
| `security/principal.py` | `security/principal.ts` | `AuthPrincipal` type |
| `security/permissions.py`, `default_role_permissions.py` | `security/permissions.ts` | DB-driven permission checks |
| `security/account_status_check.py` | `security/account-status.ts` | ACTIVE enforcement |
| `security/booking_access_check.py` | `security/booking-access.ts` | Resource-load guards |
| `security/review_access_check.py` | `security/review-access.ts` | |
| `security/cleaner_onboarding_check.py` | `security/cleaner-onboarding.ts` | |
| `security/hash.py` | `security/hash.ts` | Password hashing |
| `security/auth0_*`, `encrypting_jwt.py` | **removed** | Auth0 dependency dropped |
| `core/database.py` | `core/mongo.ts` | Cached client (`02`) |
| `core/settings.py` | `core/settings.ts` | Zod env validation (`11`) |
| `core/response_envelope.py` | `core/envelope.ts` | (`04`) |
| `core/errors.py`, `validation_errors.py` | `core/errors.ts` | (`04`) |
| `core/i18n.py`, `countries.py` | `core/i18n.ts`, `core/countries.ts` | (`12`) |
| `core/payments/*` | `core/payments/*` | Provider abstraction (`09`) |
| `core/storage/*` | `core/storage/*` | S3/local (`11`) |
| `core/queue/*`, `core/scheduler.py`, `core/task.py`, `celery_worker.py` | **removed** | Replaced by cron/webhooks/TTL (`10`) |
| `core/redis_cache.py` | `core/cache.ts` (Upstash) | (`12`) |
| `core/role_config.py` | `core/role-config.ts` | Per-role rate-limit config (`12`) |
| `email_templates/*.py` | `emails/*.tsx` | React Email (`08`) |

## Cross-references

- Endpoint-level mapping: `07-domain-endpoints.md`
- Payments provider abstraction: `09-payments.md`
- Background/cron replacements: `10-background-and-cron.md`
