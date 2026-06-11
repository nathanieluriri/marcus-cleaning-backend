# 02 — Contract Mismatches (endpoint exists, shapes differ)

These endpoints **already exist** on the backend, but the app will still fail because the path,
method, request body, or response shape doesn't match. Each can be fixed on **either** side — pick
whichever is cheaper. I note the recommended side per item.

The shared response envelope `{ success, message, data, requestId }` already matches the app's
`ApiClient` — these mismatches are about what's *inside* `data` (and the route itself).

---

## A. Customer login / signup — path + response shape

| | App expects | Backend ships |
|--|-------------|---------------|
| Path (login) | `POST /v1/customers/sign-in` | `POST /api/v1/customers/login` |
| Path (signup) | `POST /v1/customers/sign-up` | `POST /api/v1/customers/signup` |
| Signup body | `{ fullName, email, password }` | `CustomerSignupRequest` (likely `firstName`/`lastName`) |
| `data` shape | `{ accessToken, refreshToken, expiresAt, user }` | `{ customer: CustomerOut, tokens: TokenResponse }` |
| Token expiry | `expiresAt` (ISO-8601 string) | `tokens.expiresIn` (seconds, integer) |
| User object | `user { id, fullName, email, createdAt }` | `customer { id, firstName, lastName, email, … }` |

**Two real problems:**
1. **Nesting:** app reads `data.accessToken` / `data.user`; backend returns `data.tokens.accessToken`
   / `data.customer`.
2. **Expiry units:** app parses an ISO `expiresAt`; backend returns `expiresIn` seconds. Mapping
   needs `expiresAt = now + expiresIn`.
3. **Name fields:** app uses a single `fullName`; backend uses `firstName`/`lastName`.

**Recommended fix:** adjust the **app** auth models (`AuthSessionModel.fromJson` /
`auth_remote_data_source.dart`) to read the backend's `customer` + `tokens` shape and derive
`expiresAt` from `expiresIn`, and rename paths to `login`/`signup`. (Cheaper than reshaping the
backend's well-formed auth contract.) Same applies to `POST /v1/customers/refresh` — confirm the
refresh response also returns `tokens`/`expiresIn`, not flat `accessToken`/`expiresAt`.

---

## B. Create booking — path + body field names

| | App sends (`createBooking`) | Backend expects (`BookingCustomerCreateRequest`) |
|--|------------------------------|--------------------------------------------------|
| Path | `POST /v1/bookings/create` | `POST /api/v1/bookings` |
| Service | `serviceId` | `serviceId` ✅ |
| Location | `location { id, label, address }` | `placeId` (string, **required**) |
| Add-ons | `extras: [id, …]` | `addons` |
| Schedule | `schedule { date(ISO), timeWindow }` | `schedule` (**required**, shape per backend) |
| Cleaner | `cleanerId` | `cleanerId` ✅ |
| Notes | — | `notes` (optional) |
| Response | reads `data.bookingId` (string) | `data: BookingOut` (booking id is `data.id`) |

**Problems:** path has a stray `/create`; app sends a nested `location` object but backend wants a
`placeId`; `extras` vs `addons`; and the app reads `data.bookingId` while backend returns the full
`BookingOut` (id under `data.id`).

**Recommended fix:** update the **app** — drop `/create`, send `placeId` (the app already deals with
Places elsewhere), rename `extras`→`addons`, and read `data.id`.

---

## C. List bookings — response shape

| | App expects (`getAll`) | Backend ships (`BookingListOut`) |
|--|------------------------|----------------------------------|
| `data` | bare array `[ booking, … ]` | `{ items: [...], nextCursor?, pageSize }` |

The app does `if (data is! List) return []` — so against the real backend it always returns empty.
Field names also differ: app reads `serviceTitle`/`cleanerName`/`totalAmount`/`scheduledAt`/
`address`; `BookingOut` uses `serviceId`/`cleaner_id`/`price`/`schedule`/`place_id` (snake_case, IDs
not display names).

**Recommended fix:** **app** — read `data.items`, and either (a) backend enriches `BookingOut` with
display fields (`serviceTitle`, `cleanerName`, resolved `address`), or (b) the app resolves IDs →
names client-side. Option (a) is friendlier for mobile. Note `GET /v1/bookings/{id}` has the same
`BookingOut` field-name mismatch.

---

## D. Notification mark-as-read — method + path

| | App calls | Backend ships |
|--|-----------|---------------|
| Mark read | `POST /v1/notifications/{id}/read` | `PATCH /api/v1/notifications/{id}` (NotificationUpdateRequest) |

**Recommended fix:** **app** — call `PATCH /api/v1/notifications/{id}` with the body the backend's
`NotificationUpdateRequest` expects (e.g. `{ "isRead": true }`). (`read-all` is genuinely missing —
see [01](01-missing-endpoints.md#7-notifications--mark-all-read--missing).)

---

## E. Cleaner accept — path + shape

`POST /v1/cleaner/jobs/{id}/accept` (app) vs `POST /api/v1/bookings/{booking_id}/accept` (backend).
Covered in [01 §10](01-missing-endpoints.md#cleaner-app). If you choose to expose a cleaner-scoped
jobs surface, the accept lives there; otherwise re-point the app at the bookings route and map
`BookingOut` → `CleanerJob`.

---

## Field-name cheat sheet (app ↔ backend)

| Concept | App field | Backend field |
|---------|-----------|---------------|
| Booking id (create resp) | `bookingId` | `id` |
| Location | `location{}` | `placeId` |
| Add-ons | `extras` | `addons` |
| Cleaner on booking | `cleanerName` | `cleaner_id` |
| Service on booking | `serviceTitle` | `serviceId` |
| Amount | `totalAmount` / `total` | `price` |
| Schedule time | `scheduledAt` | `schedule` |
| Address | `address` | `place_id` |
| Token expiry | `expiresAt` (ISO) | `expiresIn` (sec) |
| User/customer | `user` | `customer` |
| Name | `fullName` | `firstName`+`lastName` |
