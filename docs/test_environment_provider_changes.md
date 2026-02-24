# Test Environment Provider Changes

## Summary
This update fixes and completes the local `FakePaymentProvider` so it behaves like a real payment provider contract while using only in-app database operations. It also wires the provider into app configuration and connects checkout links to a dynamic template route.

## Files Added
- `tests/test_test_environment_provider.py`
- `docs/test_environment_provider_changes.md`

## Files Updated
- `core/payments/test_environment_provider.py`
- `core/settings.py`
- `core/payments/manager.py`
- `api/web/payment_template_route.py`
- `api/v1/payments_route.py`
- `tests/test_web_payment_template.py`
- `readme.md`
- `.env.example`

## Detailed Changes

### 1) `core/payments/test_environment_provider.py`
- Rebuilt the class as a fully async provider implementation that matches `PaymentProvider` protocol methods:
  - `create_intent`
  - `verify_webhook`
  - `fetch_transaction`
  - `refund`
- Removed external HTTP behavior (`requests`) and Flutterwave-specific copy/messages.
- Added strict local behavior using `db.test_payment_intent`.
- Changed checkout link generation to:
  - `/web/payments/link/{reference}`
- Added status normalization to map raw status strings into `PaymentStatus` enum values.
- Added local-not-found handling via `resource_not_found("TestPaymentIntent", reference)`.
- Added local refund flow:
  - Updates stored record status to `refunded`
  - Stores refunded amount metadata
  - Returns `PaymentTransaction` response with provider `test`

### 2) `core/settings.py`
- Added settings fields:
  - `test_payment_base_url`
  - `test_payment_webhook_secret_hash`
- Added env mapping:
  - `TEST_PAYMENT_BASE_URL`
  - `TEST_PAYMENT_WEBHOOK_SECRET_HASH`

### 3) `core/payments/manager.py`
- Added `FakePaymentProvider` registration when `TEST_PAYMENT_BASE_URL` is set.
- Added provider key:
  - `test`
- Updated startup error message to include `TEST_PAYMENT_BASE_URL` as a valid provider config path.

### 4) `api/web/payment_template_route.py`
- Kept static route:
  - `GET /web/payments/template`
- Replaced old generic link route with dynamic route:
  - `GET /web/payments/link/{reference}`
- Dynamic route now:
  - Reads local test intent by `reference`
  - Builds page context from stored intent + metadata
  - Renders `templates/payment_template.html` with real reference/amount/currency/provider values
  - Returns 404 when reference does not exist

### 5) `api/v1/payments_route.py`
- Updated webhook route docstring to include `test` as an accepted provider value.

### 6) Tests
- Added `tests/test_test_environment_provider.py` with async unit tests for:
  - Intent creation and checkout link
  - Webhook signature validation
  - Transaction status mapping
  - Refund status update
- Extended `tests/test_web_payment_template.py` with:
  - Dynamic link rendering test for `/web/payments/link/{reference}`
  - 404 missing-reference test for dynamic route

### 7) Developer/Env Docs
- `readme.md` now documents:
  - `PAYMENT_DEFAULT_PROVIDER=test`
  - `TEST_PAYMENT_BASE_URL`
  - `TEST_PAYMENT_WEBHOOK_SECRET_HASH`
  - Dynamic template route `/web/payments/link/{reference}`
- `.env.example` now includes test-provider sample vars.

## Expected Flow After Changes
1. `POST /v1/payments/intents` with provider `test` creates local provider intent and app payment transaction.
2. Response payload contains `checkout_url` pointing to `/web/payments/link/{reference}`.
3. Opening the checkout URL renders payment details from local test intent data.
4. Webhook/refund operations resolve and update local provider-backed payment state without external API calls.
