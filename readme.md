# Marcus Cleaning Backend

FastAPI backend for the Marcus Cleaning platform. It provides:

- Role-based auth for `customer`, `cleaner`, and `admin`
- Booking lifecycle with pricing + payment transaction creation
- Place autocomplete/details/reverse-geocode integration
- Document upload intents (local or S3 storage backend)
- Payment providers (`flutterwave`, `stripe`, `test`) with webhook handling
- Permission-template system for cleaner/customer route access
- Celery queue integration and APScheduler heartbeat monitoring

## Tech Stack

- Python + FastAPI
- MongoDB (primary data store)
- Redis (rate limiting, Celery broker/backend, cache usage)
- Celery worker + Flower (optional monitoring)
- Jinja2 templates for web payment preview pages

## Project Structure

```
api/                  # FastAPI routes (v1 + web pages)
core/                 # settings, queue, payments, storage, scheduler, errors
repositories/         # database access
schemas/              # Pydantic models
security/             # auth, principal resolution, permission checks
services/             # business logic
templates/ static/    # web payment template assets
tests/                # pytest test suite
docs/                 # focused feature docs
```

## Running Locally

### 1) Prerequisites

- Python 3.11+
- MongoDB running
- Redis running

### 2) Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### 3) Configure environment

```bash
cp .env.example .env
```

Then update `.env` (see required variables below).

### 4) Start API

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 7860
```

Open:

- Swagger UI: `http://localhost:7860/docs`
- ReDoc: `http://localhost:7860/redoc`
- Health: `http://localhost:7860/health`

### 5) Optional background services

Run Celery worker:

```bash
CELERY_CUSTOM_WORKER_POOL=celery_aio_pool.pool:AsyncIOPool celery -A celery_worker worker -l info --pool=custom --concurrency=5
```

Run Flower:

```bash
celery -A celery_worker.celery_app flower --port=5555
```

## Docker Compose

Start API + worker + Mongo + Redis + Flower:

```bash
docker compose up --build
```

Services:

- API: `http://localhost:7860`
- Flower: `http://localhost:5555`

## Environment Variables

The app validates required environment variables at startup in `core/settings.py`.

### Always required

- `SECRET_KEY`
- `SESSION_SECRET_KEY`
- `GOOGLE_MAPS_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SUCCESS_PAGE_URL`
- `ERROR_PAGE_URL`
- `EMAIL_USERNAME`
- `EMAIL_PASSWORD`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`

### Database mode

- `DB_TYPE` supports `mongodb` or `sqlite`, but current repository services are implemented around async Mongo usage.
- Recommended and used in `.env.example`:
  - `DB_TYPE=mongodb`
  - `MONGO_URL`
  - `DB_NAME`

### Storage backend

- `STORAGE_BACKEND=local` or `s3`
- For `local`: `STORAGE_LOCAL_ROOT` (default `uploads`)
- For `s3`: `S3_BUCKET_NAME` required (+ optional `S3_REGION`, `S3_ENDPOINT_URL`)

### Payment provider

- `PAYMENT_DEFAULT_PROVIDER=flutterwave|stripe|test`
- For `flutterwave`: `FLUTTERWAVE_SECRET_KEY`, `FLW_WEBHOOK_SECRET_HASH`
- For `stripe`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- For `test`: `TEST_PAYMENT_BASE_URL` (optional `TEST_PAYMENT_WEBHOOK_SECRET_HASH`)
  - Set base URL to this API host, e.g. `http://localhost:7860`, so checkout links resolve to `/web/payments/link/{reference}`

### Useful optional variables

- `ROLE_RATE_LIMITS` (e.g. `anonymous:20/minute,cleaner:80/minute,customer:80/minute,admin:140/minute`)
- `BOOKING_ALLOW_ACCEPT_ON_PENDING_PAYMENT` (`true`/`false`)
- `CORS_ORIGINS` (comma-separated)
- `ENV` (`development`/`production`)
- `DEBUG_INCLUDE_ERROR_DETAILS`
- `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (needed for super-admin bootstrap/login flow)

## API Surface

Mounted routers in `main.py`:

- `/v1/admins`
  - admin auth/profile
  - permission templates + rollout
  - permission catalog (`GET /v1/admins/permissions/catalog`)
- `/v1/customers`
  - signup/login/refresh/account
  - Google OAuth routes
- `/v1/cleaners`
  - signup/login/refresh/account
  - Google OAuth routes
- `/v1/bookings`
  - create/list/get
  - cleaner accept/complete
  - customer acknowledge completion
- `/v1/places`
  - allowed countries
  - autocomplete/details/reverse geocode
  - saved search history
- `/v1/reviews`
  - list/get/create/update/delete
- `/v1/documents`
  - upload intent, complete upload, fetch/delete metadata
  - local upload/read helper routes (hidden from OpenAPI)
- `/v1/payments`
  - webhook receiver
  - fetch by id/reference
  - refund
- `/web/payments`
  - `GET /web/payments/template`
  - `GET /web/payments/link/{reference}`

## Auth, Permissions, and Rate Limits

- Auth uses Bearer tokens resolved to an `AuthPrincipal`.
- Role checks are enforced per endpoint (`customer`, `cleaner`, `admin`).
- Non-admin accounts also require:
  - `accountStatus == ACTIVE`
  - matching route permission key in `permissionList`
- Admin super account bypass is supported via static ID/email logic.
- Global rate limiting is applied per role and exposes headers:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
  - `Retry-After` (on 429)

## Response Envelope

Most endpoints return a standard shape:

```json
{
  "success": true,
  "message": "Some message",
  "data": {},
  "requestId": "..."
}
```

Validation and error responses keep the same envelope with `success: false`.

## Health Checks

`GET /health` reports:

- MongoDB status + latency
- Redis status + latency
- APScheduler heartbeat freshness

## Testing

Run tests with:

```bash
pytest
```

Test files are in `tests/` (payments, bookings, permissions, places, queue, settings validation, etc.).

## Additional Docs

- `docs/admin_permission_catalog.md`
- `docs/place_autocomplete.md`
- `docs/test_environment_provider_changes.md`
