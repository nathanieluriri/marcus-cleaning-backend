# Backend Requirements — Gap Analysis

**Question asked:** *Can the customer + cleaner apps run fully dynamic against the current
`Marcus Cleaning API`, or is the backend missing endpoints?*

**Short answer:** **No, not yet.** The backend (`api-1 (1).json`, OpenAPI 3.1, 130 routes) is
large and covers most of the platform, but the two Flutter apps were built against a *guessed*
API contract that does **not** line up with what the backend actually ships. There are:

- **10 genuinely missing endpoints** the apps call but the backend does not expose.
- **~7 contract mismatches** — the endpoint exists, but the path name, HTTP method, request body,
  or response shape differs enough that the app code will fail to parse / 404.

Until both are resolved, the HTTP data sources will throw and the apps fall back to mock data.

Base URL in use: `https://marcus-cleaning-backend.vercel.app/api/`

---

## Files in this folder

| File | What it covers |
|------|----------------|
| [01-missing-endpoints.md](01-missing-endpoints.md) | Endpoints the backend must **add** (method, path, request, response). |
| [02-contract-mismatches.md](02-contract-mismatches.md) | Endpoints that **exist** but need path/method/shape alignment. |
| [03-config-notes.md](03-config-notes.md) | Base-URL / `/api` prefix and env wiring notes (not endpoint gaps). |

---

## TL;DR scoreboard

### Customer app

| App call | Backend route | Verdict |
|----------|---------------|---------|
| `POST /v1/customers/sign-in` | `POST /api/v1/customers/login` | ⚠️ rename + response shape |
| `POST /v1/customers/sign-up` | `POST /api/v1/customers/signup` | ⚠️ rename + body + response shape |
| `POST /v1/customers/password-reset/request` | — | ❌ **MISSING** |
| `POST /v1/customers/refresh` | `POST /api/v1/customers/refresh` | ✅ (verify response shape) |
| `GET /v1/home` | — | ❌ **MISSING** (home aggregation) |
| `GET /v1/bookings/services/{id}/extras` | — | ❌ **MISSING** (public add-ons/extras) |
| `GET /v1/bookings/cleaners` | — | ❌ **MISSING** (customer cleaner browse) |
| `GET /v1/bookings/cleaners/{id}` | — | ❌ **MISSING** (public cleaner profile) |
| `GET /v1/bookings/cleaners/{id}/reviews` | `GET /api/v1/reviews` | ⚠️ no cleaner filter / cursor |
| `POST /v1/bookings/create` | `POST /api/v1/bookings` | ⚠️ rename + body mismatch |
| `GET /v1/bookings` | `GET /api/v1/bookings` | ⚠️ response shape (list vs `{items}`) |
| `GET /v1/bookings/{id}` | `GET /api/v1/bookings/{id}` | ✅ (shape diff) |
| `… /payments/mark-paid` | `POST,PATCH …/payments/mark-paid` | ✅ |
| `POST …/ratings` | `POST …/ratings` | ✅ |
| `GET /v1/notifications` | `GET /api/v1/notifications` | ✅ (shape diff) |
| `POST /v1/notifications/{id}/read` | `PATCH /api/v1/notifications/{id}` | ⚠️ method/path differ |
| `POST /v1/notifications/read-all` | — | ❌ **MISSING** (mark-all-read) |
| `DELETE /v1/notifications/{id}` | `DELETE /api/v1/notifications/{id}` | ✅ |

### Cleaner app

| App call | Backend route | Verdict |
|----------|---------------|---------|
| `GET /v1/cleaner/jobs` | — | ❌ **MISSING** (job feed) |
| `GET /v1/cleaner/jobs/{id}` | — | ❌ **MISSING** |
| `POST /v1/cleaner/jobs/{id}/accept` | `POST /api/v1/bookings/{id}/accept` | ⚠️ different path/shape |
| `POST /v1/cleaner/jobs/{id}/decline` | — | ❌ **MISSING** (no decline action) |
| `GET /v1/cleaner/profile` | — | ❌ **MISSING** (cleaner self profile) |
| `PATCH /v1/cleaner/profile` | — | ❌ **MISSING** (cleaner self update) |

> Cleaner **auth** (login / signup / onboarding / refresh) already exists on the backend
> (`/api/v1/cleaners/*`) — the cleaner app just hasn't wired it yet (still mock). No backend work needed there.

---

## What "missing" really means here

The backend is admin-heavy: it has rich admin tooling (service-definitions, add-ons, pricing,
promo codes, concierge bookings, monitoring, etc.) and solid customer auth/bookings/payments/places.
What it lacks is the **customer- and cleaner-facing read surface** the mobile apps need:

1. A **home feed** aggregation.
2. **Public discovery** of services, add-ons, cleaners, and cleaner reviews (today these only
   exist behind `/admins/*`).
3. A **cleaner-side job feed** and **cleaner self-profile** (today the cleaner only has auth +
   onboarding; jobs are modeled as `bookings` from the customer's perspective).
4. Two small conveniences: **password reset** and **notifications mark-all-read**.

See [01-missing-endpoints.md](01-missing-endpoints.md) for the proposed spec of each.
