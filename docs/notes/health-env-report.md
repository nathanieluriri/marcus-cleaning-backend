# Health env report + OTP email failure surfacing

Date: 2026-07-31
Branch: `master` (fast-forwarded from `f44cac9` to `c1eefd2` before work started)

## Why

Two symptoms on the Vercel deployment:

1. No way to tell which environment variables are actually configured there.
2. Admin login returned an opaque `500 Internal Server Error` **after a correct
   password**, with nothing in the response explaining the cause.

Both are addressed below.

## 1. `GET /api/health` now reports an `env` block

`app/server/routes/health.ts`

The existing response is unchanged — `status`, `timestamp` and `services` keep
their exact shapes. A new top-level `env` object is added, and the zod/OpenAPI
response schema was extended to match so `/api/reference` stays accurate.

### Safety contract

**Booleans only.** No value, no length, no prefix, no hash. The only literals
reported are three non-secret mode strings: `storageBackend`, `nodeEnv`, `env`.
This is a public endpoint, so the constraint is load-bearing and is pinned by
tests (see below).

### Keys

| Key | Meaning |
| --- | --- |
| `mongodbUri`, `dbName`, `jwtSecret` | required trio — the app cannot boot without these |
| `resendApiKey` | `RESEND_API_KEY` is set |
| `emailFromConfigured` | `RESEND_FROM_EMAIL` **or** `EMAIL_FROM` is set to something other than the built-in placeholder |
| `emailFromSource` | literal `'RESEND_FROM_EMAIL' \| 'EMAIL_FROM' \| 'default'` — which var actually supplies the sender. A var **name**, never its value |
| `superAdminEmail`, `superAdminPassword` | bootstrap admin credentials |
| `corsOriginsConfigured` | `false` means CORS falls back to `http://localhost:3000` |
| `storageBackend` | literal `'s3' \| 'local' \| 'blob'` |
| `s3BucketName` | `S3_BUCKET_NAME` is set (required when backend is `s3`) |
| `firebaseProjectId`, `fcmProjectId`, `fcmClientEmail`, `fcmPrivateKey` | Firebase auth + push |
| `upstashRedis` | `true` only when **both** REST url and token are set |
| `adminOtpRequired` | the effective boolean, not mere presence |
| `otpDevCodeSet` | **must be `false` in production** — it is a 2FA bypass |
| `adminCookieDomainSet` | expected `false` unless cookies are deliberately shared across subdomains |
| `publicAppUrlConfigured`, `adminLoginUrlConfigured` | `false` = falling back to the built-in default |
| `nodeEnv`, `env` | literal runtime mode |

### Two deliberate implementation choices

**Reads `process.env` directly, not `getSettings()`.** Settings validation
*throws* when a required var is missing — which is precisely the situation this
report exists to explain. Going through `getSettings()` would make the endpoint
fail in exactly the case you most need it. The four defaults it needs
(`STORAGE_BACKEND='s3'`, `ADMIN_OTP_REQUIRED=true`, `NODE_ENV`/`ENV`
`='development'`) are mirrored inline with a comment pointing at
`server/core/settings.ts`.

**`DEFAULT_EMAIL_FROM` is now exported from `settings.ts`** and used both as the
schema default and by the `emailFromConfigured` check, so the two cannot drift.
The check treats the placeholder `Marcus Cleaning <no-reply@example.com>` as *not
configured*: Resend rejects a sender on an unverified domain, so leaving it in
place means every transactional email fails — including the login OTP. That is
the most likely root cause of symptom (2).

A var also counts as unset when it is present but blank/whitespace.

### The sender address has two accepted names

`RESEND_FROM_EMAIL` (preferred — it is what Resend's own docs call it) and
`EMAIL_FROM` (the original name here) both work. `RESEND_FROM_EMAIL` wins when
both are set. The precedence lives in one place, `resolveEmailFromWithSource()`
in `server/core/settings.ts`; both the send helpers and this endpoint call it, so
the reported source cannot disagree with the address Resend is actually handed.
Health still passes it raw `process.env` values rather than parsed settings, for
the reason above.

Setting the *winning* var to the placeholder reports `'default'` /
`emailFromConfigured: false` — precedence is unconditional, so a good
`EMAIL_FROM` does not rescue a placeholder `RESEND_FROM_EMAIL`. The invariant
`emailFromConfigured === (emailFromSource !== 'default')` is pinned by a test.

## 2. A failed OTP email is now a controlled 502, not a 500

`app/server/services/admin-otp-service.ts`

Previously: `getResend()` throws a **plain** `Error` when `RESEND_API_KEY` is
absent; `createChallenge` let it propagate; the global `onError` handler mapped
any non-`AppError` to `500 INTERNAL_ERROR`. The admin saw a bare 500 after a
correct password.

Now the `sendOtpEmail` call is wrapped:

- `console.error('[admin-otp] failed to send login OTP email', err)` — the
  underlying error lands in the Vercel function logs.
- Rethrown as `AppError(502, 'OTP_EMAIL_FAILED', 'Could not send your login code.
  Email is not configured or the sender domain is not verified.')`.

The error is not swallowed, and the provider message never reaches the client
(it can carry account/config detail). `translate()` passes the message through
unchanged, so the client sees the text above.

### Challenge-row behaviour on failure (as asked)

`createChallenge` **sends the email before inserting the challenge row**
(`sendOtpEmail` at the top of the `method === 'email'` branch, `insertChallenge`
after it). So a failed send leaves **no row behind** — nothing to expire, nothing
to clean up, and no state that could block a retry. A fresh challenge is created
per login attempt regardless. This is pinned by a test that asserts
`challengesStore.size === 0` after the failure and then completes a full
login + verify on the retry.

TOTP-enrolled admins are unaffected: that path sends no email at all.

## Tests

- **`app/tests/health-env.test.ts`** (new, 12 tests). Mongo mocked. Covers: the
  pre-existing `status`/`timestamp`/`services` contract still holds; degraded
  path still returns `env`; all-set → all `true`; all-unset → all `false` with
  the documented defaults; blank string counts as unset; the `EMAIL_FROM`
  placeholder reports `false`; `upstashRedis` needs both halves;
  `adminOtpRequired` reports the effective boolean.
  The leak tests seed sentinel values into every secret-bearing var and assert
  **none of them appear anywhere in the serialized body**, that every `env` key
  is a boolean apart from the three mode strings, and that no secret prefix
  appears.
- **`app/tests/admin-otp-login.test.ts`** (extended, +5 tests). A rejecting
  `sendOtpEmail` yields `OTP_EMAIL_FAILED` / `502` rather than a raw 500; the
  underlying error is logged exactly once; the provider message leaks into
  neither `message` nor `details`; no challenge row persists and the retry
  succeeds end to end; the TOTP path never attempts an email.

### Results

`npm test` — **305 passed / 36 files, green.** `npm run typecheck` — clean.
`npm run lint` — 0 errors, 1 pre-existing warning in `saved-address-service.ts`
(untouched by this change).

The first full-suite run hit the known flaky timeout in
`tests/admin-preset-route-coverage.test.ts` (20s cap under parallel load). It
passes in 4.9s in isolation and the immediate re-run of the full suite was fully
green — not a regression from this change.

## How to use it

Hit `GET /api/health` on the deployment and read `env`. For the login-500
symptom, the fields to check first are `resendApiKey` and `emailFromConfigured`
— if either is `false`, the OTP email cannot be delivered and login will now
return a clear `OTP_EMAIL_FAILED` / 502 explaining that, with the provider's
reason in the Vercel logs.

Also worth confirming on a production deployment: `otpDevCodeSet` must be
`false` (boot refuses to start otherwise), `corsOriginsConfigured` should be
`true`, and `adminCookieDomainSet` should normally be `false`.
