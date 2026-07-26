# 05 — Frontend follow-ups (round 2)

Answers to the five gaps the frontend reported after reviewing `04-newly-implemented.md`,
plus the Firebase question. **All five were valid** — four were real gaps, one was a
documentation error on our side. All are now fixed.

Live contract: `/api/reference` · OpenAPI JSON: `/api/doc`

---

## 1. Firebase for Google/Apple sign-in — yes, and it is now the recommended path

You asked whether Firebase could serve native Android, iOS and web from one integration.
It can, and that is what we have built.

**What was actually there before:** Google OAuth *was* implemented, but as a **browser
redirect flow** (`GET /google/auth` → Google → `GET /auth/callback`), and those routes were
deliberately excluded from the OpenAPI spec because they are redirect targets, not JSON
endpoints. So your report was right in effect — you found nothing in the spec, and a
redirect flow is the wrong shape for native sign-in anyway. That was our documentation
error, and it is corrected: the redirect routes are documented, and a native endpoint exists.

**Use this:**

```
POST /api/v1/customers/auth/social      (customer app)
POST /api/v1/cleaners/auth/social       (staff app)

{ "idToken": "<token from the sign-in SDK>" }

200 → { accessToken, refreshToken, tokenType, expiresIn,
        userId, email, isNewUser, provider }
```

The app runs native sign-in with the Firebase SDK, calls `user.getIdToken()`, and posts the
result. The backend verifies the token's signature against Google's rotating certificates,
pins the issuer and audience to our Firebase project, then issues **our own** access +
refresh tokens. From that point everything is identical to password login — same tokens,
same refresh, same rotation.

**Why this answers the platform question:** what is verified is the *token*, not the
platform or the flow. Android, iOS and web all produce the same Firebase ID token, so one
endpoint serves all three. And because **Apple sign-in through Firebase produces the same
token type**, Apple works through this endpoint with no additional backend work — you just
enable it in the Firebase console. The `provider` field comes back as `firebase:google.com`,
`firebase:apple.com`, and so on.

The endpoint also accepts a **bare Google Sign-In SDK** ID token (issuer
`accounts.google.com`) if you would rather not adopt Firebase — it routes on the `iss` claim.
Firebase is the better choice given you want Apple too.

`isNewUser` tells you whether to route into onboarding. Accounts are matched on email, so a
user who signed up with a password and later taps "Continue with Google" lands on their
existing account rather than a duplicate.

**Config needed:** `FIREBASE_PROJECT_ID` (falls back to `FCM_PROJECT_ID` — the same project
serves push and auth). For bare Google tokens: `GOOGLE_CLIENT_ID`, and optionally
`GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` as additional accepted audiences.

---

## 2. "Cleaner is on the way" — fixed, and you were right that it was unbuildable

This was the real one. `BookingOut.status` had no in-progress state, `JobSessionOut` was
cleaner-side only, and there was no ETA anywhere. The customer genuinely could not tell that
their job had started. Our doc said "poll `GET /bookings/{id}`", which did not match what
that endpoint returned.

**Three things changed.**

**A cleaner can now declare they are on the way:**

```
POST /api/v1/cleaner/jobs/{jobId}/en-route
{ "etaMinutes": 15 }          // or { "etaAt": <epoch seconds> }
```

**The customer gets a dedicated progress resource:**

```
GET /api/v1/bookings/{booking_id}/progress

{ "bookingId", "state", "percent", "startedAt", "enRouteAt", "etaAt",
  "completedAt", "elapsedSeconds", "tasksCompleted", "tasksTotal",
  "cleanerName", "cleanerAvatarUrl", "pollIntervalSeconds" }
```

`state` is `PENDING | SCHEDULED | EN_ROUTE | IN_PROGRESS | COMPLETED | CANCELLED`, and
`percent` (0/10/35/65/100) is computed server-side so the bar has one definition. Poll at
`pollIntervalSeconds` — 20s while the job is live, 120s when nothing is moving.

**And `BookingOut` carries it too:** `GET /bookings/{id}` now includes a `progress` object,
so the details screen needs one call, not two. It is `null` on **list** responses — filling
it would cost a session lookup per row — so use the progress endpoint for polling.

Note we did **not** add `IN_PROGRESS` to `BookingStatus`. That enum is consumed by the web
client and the admin panel, and widening it would break their exhaustive switches. Progress
is a separate, additive field. `status` keeps its existing five values.

Checklist counts are included, so the bar can show real movement rather than a fake
animation.

---

## 3. Hourly rate and minimum hours — added

`CatalogServiceOut` gained `hourlyRate`, `minimumHours`, `priceUnit` (`HOURLY | FLAT`),
`startingPrice` and `currency`. **`startingPrice` is the number for your "from $X" copy** —
it resolves to the hourly rate for hourly services and the base price for flat ones, so the
client never has to choose.

And the endpoint you originally asked for now exists:

```
GET /api/v1/services/{serviceId}/pricing

{ serviceId, title, priceUnit, basePrice, hourlyRate, minimumHours,
  hourIncrement, maximumHours, currency, extras[], quotePath }
```

One call for the whole Duration & Extras screen. `hourIncrement` (default 0.5) drives the
duration stepper. **`quotePath` is a deliberate reminder**: the live total still comes from
`POST /v1/bookings/quote`. These fields are the picker's inputs, not a licence to total
client-side.

Caveat worth stating plainly: these read from admin `service_definitions` documents. If an
admin has not set `hourlyRate` / `minimumHours` on a service, they come back `null` and
`priceUnit` falls back to `FLAT`. The plumbing is there; **someone has to populate the data**.

---

## 4. Job feed filters and real distance — added

`GET /v1/cleaner/jobs` now takes:

| Param | Values |
|---|---|
| `scope` | `available` (unassigned pool) · `assigned` (yours) · `all` (default) |
| `lat`, `lng` | caller position — required for any distance |
| `radiusMiles` | 0–200 |
| `from`, `to` | schedule window, epoch seconds |
| `status` | booking status |
| `sort` | `schedule` (default) · `distance` |

That gives the Available Jobs tab its backing and makes the 3.2-mile filter real.

**`distanceMiles` is now genuinely computed** — haversine, from the customer's saved address
coordinates to the `lat`/`lng` you send. Two honest limits:

- **No coordinates sent → no distances.** Distance needs an origin; there is no way around
  that. Send the device position.
- **A job whose address has no stored coordinates keeps `distanceMiles: null` and is *not*
  filtered out by `radiusMiles`.** Hiding real work because of missing address data would be
  worse than showing it unfiltered.

The response is still a plain `CleanerJobOut[]` — we did not change the shape, to avoid
breaking existing consumers.

---

## 5. Recently booked cleaners — added

```
GET /api/v1/bookings/cleaners/recent?limit=5
```

Distinct cleaners this customer has actually booked, most recent first. `GET /v1/home` also
gained a **`recentCleaners`** array alongside `featuredCleaners`, so the home screen needs no
extra call. You were right that `featuredCleaners` is a different thing — it is a directory
browse, not history.

---

## Still genuinely open

- **Apple sign-in** needs enabling in the Firebase console. No backend work left.
- **`isPriority`** on cleaner jobs is still hardcoded `false` — there is no priority model.
- **`hourlyRate` on cleaner cards** (`CleanerCardOut`) is still `null`; rates live on
  services, not on cleaners.
- **`onlyAvailableNow`** in cleaner browse is still a no-op — it predates the availability
  data, and now that `/v1/cleaner/availability` exists we can wire it if you need it.
- **Money representation** is still split: major units customer-side, minor units in
  payments. Unchanged pending your call.
- **Service rate data** must be populated by an admin before the "from $X/hr" copy renders
  anything but the base price.
