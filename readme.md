# FasterAPI Project Template

This scaffold is a production-ready FastAPI starter with:

- Envelope-based API responses (`success`, `message`, `data`, optional `meta`, `requestId`)
- Typed auth principal dependencies (member/admin)
- Queue abstraction with singleton manager (Celery-first)
- Document upload abstraction (local + S3)
- Payment abstraction (Flutterwave + Stripe + Test)

## Environment

Copy `.env.example` to `.env` and set required values.

Key variables:

- `SECRET_KEY`, `SESSION_SECRET_KEY`
- `MONGO_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- `STORAGE_BACKEND` (`local` or `s3`)
- `PAYMENT_DEFAULT_PROVIDER` (`flutterwave`, `stripe`, or `test`)
- Provider secrets (`FLUTTERWAVE_SECRET_KEY`, `STRIPE_SECRET_KEY`)
- Local test provider (`TEST_PAYMENT_BASE_URL`, optional `TEST_PAYMENT_WEBHOOK_SECRET_HASH`)

## New API Modules

- `GET/POST/DELETE /v1/documents/*`
- `POST/GET /v1/payments/*`

## Web Template Routes

- `GET /web/payments/template`: test payment page template (Jinja2 + static CSS/JS, UI-only success animation)
- `GET /web/payments/link/{reference}`: dynamic test provider payment page resolved from local test intent records

## Permission Management Docs

- `docs/admin_permission_catalog.md`: admin permission catalog + frontend integration flow for template updates and rollout
- `docs/place_autocomplete.md`: places autocomplete/details/reverse-geocode endpoints and caching behavior

## Queue Usage

Use the queue manager instead of calling Celery directly:

```python
from core.queue.manager import QueueManager

QueueManager.get_instance().enqueue("delete_tokens", {"userId": user_id})
```

## Response Documentation

Use `document_response` helpers in routes:

- `@document_response(...)`
- `@document_created(...)`
- `@document_deleted(...)`
- `@document_paginated(...)`

### Validation Error Details (422)

Validation failures still return the standard envelope with `data.code = VALIDATION_FAILED`.
For readability, `data.details` now includes:

- `summary`: concise human-readable summary
- `missingFields`: missing required fields (if any)
- `fieldErrors`: normalized per-field errors (`path`, `location`, `message`, `errorType`)
- `errors`: raw FastAPI/Pydantic errors (kept for backward compatibility)
