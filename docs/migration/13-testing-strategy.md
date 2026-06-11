# 13 — Testing Strategy

The current backend has a strong test suite (49 `tests/*.py`). The migration must reach **parity confidence**: the new API behaves identically to the old one for the three clients. This document defines the test layers and the contract-parity approach.

## Tooling

- **Vitest** as the test runner (fast, ESM-native, TS-first).
- **`mongodb-memory-server`** (or a disposable Atlas/test DB) for repository + integration tests.
- **Hono test client** (`app.request(...)`) to exercise routes without a network listener — fast and serverless-friendly.
- **`supertest`-style** flows optional; Hono's built-in `app.request` is usually enough.

## Test layers (mirror the current suite)

| Layer | What | Maps to current tests |
|-------|------|-----------------------|
| **Unit — services** | Business logic with repositories mocked: booking state machine, pricing, reconcile, permission checks, session policy | `test_booking_service`, `test_pricing_service`, `test_payment_reconciliation_service`, `test_auth_session_policy`, `test_permissions`, etc. |
| **Unit — security** | JWT sign/verify, refresh rotation + reuse detection, account-status, access checks | `test_local_auth_verifier`, `test_auth0_verifier_and_token_repo` (now JWT), `test_account_status_check`, `test_review_access_check` |
| **Integration — repositories** | Real Mongo (memory server): CRUD, indexes, TTL, cursor pagination | repo-touching tests |
| **Route/contract** | `app.request()` per endpoint: status, envelope shape, validation errors, headers | `test_*_route.py` (admin, bookings, payments, places, customer-contract, language) |
| **Cross-cutting** | Response envelope, validation error format, i18n, rate-limit headers, import cycles | `test_response_envelope`, `test_validation_error_format`, `test_i18n`, `test_import_cycles`, `test_settings_env_validation` |

## Contract parity (the critical addition)

To guarantee the three clients keep working, add a **parity test set** that pins the public contract:

1. **Golden response shapes.** For each endpoint, capture representative responses from the *current* Python API (run it, hit endpoints, save JSON) into `tests/golden/<endpoint>.json`. New route tests assert the new response matches the golden shape (keys, types, envelope, status). This catches accidental field renames or envelope drift.
2. **OpenAPI snapshot.** Generate `openapi.json` from the new app (`getOpenAPIDocument`, see `05`) and snapshot-test it. Any unintended path/param/schema change fails CI. Cross-check the documented paths against the inventory in `07`.
3. **Alias coverage.** Explicit tests for the dual snake/camel query params on `GET /v1/bookings` and the route aliases (`/sign-in`↔`/login`, `/profile/*`↔`/me/*`, `mark-paid` POST↔PATCH) — these are easy to drop in a rewrite.
4. **Auth contract.** Login/refresh request+response shapes unchanged; refresh rotation issues a new token and invalidates the old; reuse of a consumed refresh token revokes the family (negative test).

## Serverless-specific tests

- **Cron handlers:** unit-test the service call; integration-test the `CRON_SECRET` guard (401 without the bearer, 200 with). Assert idempotency (running twice yields the same end state).
- **Webhooks:** signature verification (valid → processed, tampered → 400), and idempotent replay (same event id processed once).
- **Mongo client reuse:** assert the client is module-cached (no new pool per call) — a lightweight test that the exported client identity is stable.
- **TTL:** can't easily test the 60s sweep; instead test that validation **re-checks `expiresAt`/`revokedAt`** so expiry is enforced regardless of TTL timing.

## What to port vs rewrite

- **Port the intent**, not the Python. Each `test_*.py` has a clear behavioral assertion — re-express it in Vitest against the new code.
- Prioritize porting: `test_booking_service`, `test_payment_reconciliation_service`, `test_auth_session_*`, `test_permissions`, `test_response_envelope`, `test_validation_error_format`, and all `*_route` tests — these encode the contract.
- `test_queue_registry` / Celery-specific tests are dropped (no queue); replace with cron-handler tests.

## CI

- Run Vitest on every PR; fail on OpenAPI snapshot drift and golden-shape mismatch.
- Type-check (`tsc --noEmit`) and lint as gates.
- A pre-cutover **parity run** against a staging deployment hitting the same request set as the old API (see `14`).

## Cross-references

- Endpoint inventory (parity source of truth): `07-domain-endpoints.md`
- OpenAPI generation: `05-api-docs-scalar.md`
- Migration phases / staging parity run: `14-migration-plan.md`
