# 01 — Endpoints the Backend Must Add

These are routes the apps **call** but the backend **does not expose** anywhere (not even under a
different name). Each is what the Flutter data sources expect today. All responses should use the
existing envelope `{ "success": true, "message": "...", "data": <payload>, "requestId": "..." }`
so the apps' `ApiClient._unwrapResponse` keeps working.

Paths below are shown with the `/api` prefix (real base = `https://marcus-cleaning-backend.vercel.app/api/`).

---

## Customer app

### 1. Password reset (request) — ❌ missing
```
POST /api/v1/customers/password-reset/request
Auth: none
Body: { "email": "user@example.com" }
Resp 200: { ...envelope..., "data": null }   // always 200 to avoid email enumeration
```
Called from [auth_remote_data_source.dart](../apps/customer_app/lib/features/auth/data/datasources/auth_remote_data_source.dart) `requestPasswordReset`.
> Recommended: also add a `POST /api/v1/customers/password-reset/confirm` `{ token, newPassword }`
> so the reset flow can actually complete (the app doesn't call it yet, but you'll need it).

### 2. Home aggregation — ❌ missing
```
GET /api/v1/home
Auth: bearer (customer)
Resp 200 data: HomePageModel
```
Called from [home_remote_data_source.dart](../apps/customer_app/lib/features/home/data/datasources/home_remote_data_source.dart).
The exact shape the app parses lives in `home_models.dart` (`HomePageModel.fromJson`) — typically
greeting/user, promo banners, service categories, featured cleaners, active/recent bookings.
> Alternative: don't build a bespoke aggregator — instead expose the underlying pieces
> (services, banners, featured cleaners) and let the app compose the home screen. Either is fine,
> but **one** of them must exist.

### 3. Public service catalog + extras/add-ons — ❌ missing
```
GET /api/v1/bookings/services/{serviceId}/extras
Auth: bearer (customer)
Resp 200 data: [ { "id": "...", "title": "...", "price": 20, "isAvailable": true } ]
```
Called from [booking_remote_data_source.dart](../apps/customer_app/lib/features/booking/data/datasources/booking_remote_data_source.dart) `fetchExtras`.
> Today add-ons + service definitions only exist under `/admins/add-ons` and
> `/admins/service-definitions`. The customer app needs a **public, read-only** projection of
> these (a customer should not hit `/admins/*`). Also consider `GET /api/v1/services` for the
> service catalog itself if the app stops hard-coding services.

### 4. Customer-facing cleaner browse / search — ❌ missing
```
GET /api/v1/bookings/cleaners
Auth: bearer (customer)
Query: minRating?, maxHourlyRate?, onlyAvailableNow?
Resp 200 data: [ Cleaner ]   // id, name, rating, jobsDone, hourlyRate, isVerified,
                             //  avatarUrl, roleLabel, yearsExperience, bookingsCount, heroImageUrl
```
Called from `fetchCleaners`. `/admins/cleaners` exists but is admin-scoped and a different shape.

### 5. Public cleaner profile — ❌ missing
```
GET /api/v1/bookings/cleaners/{cleanerId}
Auth: bearer (customer)
Resp 200 data: CleanerProfile  // id, name, yearsExperience, roleLabel, heroImageUrl, rating,
                              //  reviewsCount, bookingsCount, hourlyRate, certifications[],
                              //  about, reviewPreview[]
```
Called from `getCleanerProfile`.

### 6. Cleaner-scoped reviews (paginated) — ⚠️ partially covered
```
GET /api/v1/bookings/cleaners/{cleanerId}/reviews
Auth: bearer (customer)
Query: cursor?, pageSize=10, stars?, timePeriod=all|last30Days|last90Days|lastYear
Resp 200 data: { "items": [ CleanerReview ], "nextCursor": "..."|null }
              // CleanerReview: id, reviewerName, rating, text, timestamp, avatarUrl
```
Called from `fetchCleanerReviews`. The backend has a **generic** `GET /api/v1/reviews`, but the app
needs it **filtered by cleaner** with `stars` + `timePeriod` filters and **cursor** pagination.
> Cheapest fix: add `cleanerId`, `stars`, `timePeriod`, `cursor` query params to `GET /api/v1/reviews`
> and have the app point there — see [02-contract-mismatches.md](02-contract-mismatches.md).

### 7. Notifications — mark all read — ❌ missing
```
POST /api/v1/notifications/read-all
Auth: bearer
Resp 200: { ...envelope..., "data": null }
```
Called from [notifications_remote_data_source.dart](../apps/customer_app/lib/features/notifications/data/datasources/notifications_remote_data_source.dart) `markAllAsRead`.

---

## Cleaner app

> The cleaner app models work as **"jobs"**, but the backend models the same work as **`bookings`**.
> Either add a cleaner-scoped jobs surface (below), or expose booking endpoints filtered to the
> authenticated cleaner and re-point the app. The data the app needs:
> `CleanerJob` = id, title, clientName, scheduledAt, address, price, distanceMiles, status, notes, isPriority.

### 8. Cleaner job feed (list) — ❌ missing
```
GET /api/v1/cleaner/jobs
Auth: bearer (cleaner)
Resp 200 data: [ CleanerJob ]
```
Called from [cleaner_jobs_data_source.dart](../apps/cleaner_app/lib/features/jobs/data/datasources/cleaner_jobs_data_source.dart) `getJobs`.
The app unwraps either a bare list or `{ "data": [...] }`.

### 9. Cleaner job by id — ❌ missing
```
GET /api/v1/cleaner/jobs/{jobId}
Auth: bearer (cleaner)
Resp 200 data: CleanerJob
```

### 10. Cleaner accept / decline job — ⚠️/❌
```
POST /api/v1/cleaner/jobs/{jobId}/accept     Resp 200 data: CleanerJob   // ⚠️ exists as /bookings/{id}/accept
POST /api/v1/cleaner/jobs/{jobId}/decline    Body: { "reason"?: "..." }   // ❌ no decline action at all
                                             Resp 200 data: CleanerJob
```
Backend has `POST /api/v1/bookings/{booking_id}/accept` (different path + booking shape) and
`acknowledge` / `complete`, but **no decline**. The cleaner app needs both accept and decline that
return the updated job in the `CleanerJob` shape.

### 11. Cleaner self-profile read + update — ❌ missing
```
GET   /api/v1/cleaner/profile                Resp 200 data: CleanerProfile(self)
PATCH /api/v1/cleaner/profile                Body: { fullName, email, phone, bio,
                                                     serviceRadiusMiles, services[], availableDays[] }
                                             Resp 200 data: CleanerProfile(self)
```
Called from [cleaner_profile_data_source.dart](../apps/cleaner_app/lib/features/profile/data/datasources/cleaner_profile_data_source.dart).
Self-profile shape: id, fullName, email, phone, bio, rating, reviewsCount, completedJobs,
serviceRadiusMiles, services[], availableDays[], avatarUrl.
> Backend only has `PUT /api/v1/cleaners/onboarding` today — that's onboarding, not an ongoing
> editable profile, and the shape differs.

---

## Summary count

**Genuinely missing (must add): 10**
1. Password reset request (+ confirm)
2. Home aggregation
3. Public service extras/add-ons
4. Customer cleaner browse/search
5. Public cleaner profile
6. Cleaner-scoped reviews w/ filters+cursor *(or extend `/reviews`)*
7. Notifications mark-all-read
8. Cleaner jobs list
9. Cleaner job decline *(accept exists under bookings)*
10. Cleaner self-profile GET + PATCH
