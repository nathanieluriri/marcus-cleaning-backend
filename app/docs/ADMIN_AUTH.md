# Admin Auth Flow

Reference for the frontend team integrating with the admin platform's login,
2FA, password, and invite flows. All endpoints below are mounted under
`/api/v1/admins` unless noted otherwise, and all responses use the standard
envelope: `{ success, message, data, requestId }`.

## 1. Login

`POST /api/v1/admins/login`

Body: `{ email, password }`

Two possible outcomes:

- **`ADMIN_OTP_REQUIRED=true` (default in every environment):** no tokens
  are issued yet. The response `data` is an OTP challenge:

  ```json
  { "otpRequired": true, "otpChallengeId": "…", "method": "email" | "totp" }
  ```

  `method` is `"totp"` if the admin has TOTP enabled, otherwise `"email"`
  (a code is emailed automatically). Continue with **verify-otp** below.

- **`ADMIN_OTP_REQUIRED=false` (legacy behaviour, kept for frontend
  compatibility until the 3b rollout):** login completes immediately. The
  response `data` is `{ admin, tokens }` (see verify-otp response shape
  below) and session cookies are set on the response.

If the account has an expired temporary password, login fails before any
challenge/cookie is created — see `TEMP_PASSWORD_EXPIRED` in the error table.

## 2. Verify OTP

`POST /api/v1/admins/verify-otp`

Body: `{ challengeId, code }`

- `code` is the 6-digit emailed code (method `"email"`), a live TOTP code, or
  a single-use backup code (method `"totp"`).
- On success, sets the `admin_access` / `admin_refresh` httpOnly cookies
  (see Cookies below) and responds with:

  ```json
  { "admin": { …AdminOut }, "tokens": null | { accessToken, refreshToken, tokenType, expiresIn, language } }
  ```

  `tokens` is `null` for normal browser clients. Send the request header
  `X-Auth-Include-Tokens: 1` to also get the raw tokens in the body (for
  tooling/tests that can't read httpOnly cookies — mobile/native clients
  that don't want cookie-based sessions should use this).

- A challenge allows **5 attempts**. The 6th call (even with the correct
  code) is rejected as `OTP_LOCKED` without checking the code — attempts are
  incremented atomically server-side, so concurrent guesses can't exceed the
  budget.
- A challenge expires a short time after issuance (`OTP_EXPIRED`) and is
  single-use (`OTP_INVALID` on replay after a successful verify).
- In non-production environments, setting `OTP_DEV_CODE` on the server lets
  that fixed code satisfy any email-method challenge (bypassing the emailed
  code) — useful for local/dev/test. The server refuses to boot if
  `OTP_DEV_CODE` is set while `NODE_ENV=production` (`assertProductionPosture`,
  wired into `server/app.ts` at module init).

## 3. Refresh

`POST /api/v1/admins/refresh`

Body (optional — falls back to the `admin_refresh` cookie if omitted):
`{ refreshToken }` (or `refresh_token`).

Rotates the refresh token (reuse detection applies) and re-sets both
cookies. Response `data` is `null` unless `X-Auth-Include-Tokens: 1` is set,
in which case it's the token bundle.

## 4. Logout

`POST /api/v1/admins/logout` (requires an authenticated session)

Revokes the current session and clears both admin cookies. Response:
`{ ok: true }`.

## 5. TOTP (authenticator app) setup / verify / disable / backup codes

All require an authenticated session (bearer or cookie).

- **`POST /api/v1/admins/2fa/setup`** — begins (or restarts) enrollment.
  Stores a *pending* secret, returns `{ secret, otpauthUri }` for rendering
  a QR code. Not yet enabled — login still uses the previous method (email,
  or nothing) until verified.
- **`POST /api/v1/admins/2fa/verify`** — body `{ code }`, a live code from
  the authenticator app for the pending secret. On success TOTP becomes the
  admin's login method and the response is `{ backupCodes: string[] }` — **8
  backup codes, shown once, in plaintext.** Store/display them; they cannot
  be retrieved again (only regenerated, invalidating the old set).
- **`DELETE /api/v1/admins/2fa`** — body `{ code }` (live TOTP or a backup
  code). Disables TOTP, clears the secret and all backup codes; the admin
  falls back to email OTP.
- **`POST /api/v1/admins/2fa/backup-codes/regenerate`** — body `{ code }`.
  Invalidates all existing backup codes and mints a fresh set (response
  shape same as verify: `{ backupCodes: string[] }`, shown once).

The raw TOTP secret and backup-code hashes are never exposed via the admin
profile or any other read endpoint — they only ever appear in the two
one-time responses above (`TotpSetupData.secret`, `TotpBackupCodesData.backupCodes`).

## 6. Change password

`POST /api/v1/admins/change-password` (requires an authenticated session)

Body: `{ currentPassword, newPassword }` (`newPassword` min length 8).

Verifies the current password, rotates it, clears `mustChangePassword` /
`tempPasswordExpiresAt`, and revokes every **other** session for that admin
(the session making the call stays alive). This endpoint is explicitly
**exempt** from the `mustChangePassword` gate described next.

### `mustChangePassword` gate

An admin created via invite (or given a temp password) has
`mustChangePassword: true` until they change it. While set, the mount-level
guard restricts the account to a small allow-list regardless of its
permission preset:

- `POST /change-password`
- `GET /profile`
- `POST /logout`
- `GET|POST|DELETE /sessions*`

Any other admin route returns **403 `PASSWORD_CHANGE_REQUIRED`**. The
frontend should detect this on any 403 and route the admin to a
change-password screen.

## 7. Invites & temporary passwords

`POST /api/v1/admins/invites` (authenticated; typically requires the
inviting admin's own permission preset to cover admin management)

Body: `{ email, fullName, accessPreset }`. Creates the admin with a random
temporary password (`mustChangePassword: true`, 72h expiry) and emails the
temp password + `ADMIN_LOGIN_URL`. Response is the created `AdminOut` (no
password/secret fields).

`POST /api/v1/admins/invites/{admin_id}/resend` — re-issues a fresh temp
password (new 72h expiry) and re-sends the invite email. `409` if the admin
has already activated (changed their password).

If a temp password is presented after `tempPasswordExpiresAt` has passed,
login fails immediately with `TEMP_PASSWORD_EXPIRED` — before any OTP
challenge is created and before any email is sent.

## 8. Access presets

`GET /api/v1/admins/access-presets` (authenticated; implicit self-service —
any authenticated admin may read the catalog)

Returns the named permission bundles available for invites/role assignment:
`all_controls`, `operations_only`, `support_only`, `content_support`,
`finance_only`. Each item is `{ key, label, description, permissionCount }`.
`all_controls` is the super-admin bundle (wildcard — every permission).

Presets are also set/changed via `PATCH /api/v1/admins/{admin_id}/access-preset`
and bulk-applied via `POST /api/v1/admins/access-presets/bulk` (both require
admin-management permission — not implicit self-service).

## Error codes

| Code | HTTP status | Where | Meaning |
| --- | --- | --- | --- |
| `INVALID_CREDENTIALS` | 401 | login, change-password | Wrong email/password (or wrong current password) |
| `TEMP_PASSWORD_EXPIRED` | 401 | login | `mustChangePassword` is set and the 72h temp-password window has passed; no challenge/email is created |
| `OTP_INVALID` | 401 | verify-otp | Wrong code, or the challenge was already consumed |
| `OTP_EXPIRED` | 401 | verify-otp | Challenge has expired |
| `OTP_LOCKED` | 429 | verify-otp | 5 failed attempts already recorded on this challenge — further attempts (even correct ones) are rejected without checking the code; retry after a new challenge (re-login) |
| `TOTP_INVALID` | 401 | 2fa/verify, 2fa (disable), 2fa/backup-codes/regenerate | Wrong TOTP/backup code |
| `PASSWORD_CHANGE_REQUIRED` | 403 | any admin route while `mustChangePassword` is set, outside the allow-list | Admin must change their password before continuing |
| `FORBIDDEN` | 403 | any admin route | Authenticated, but the admin's permission preset (or lack of `isSuperAdmin`/wildcard) doesn't cover this route; also the fail-closed response for any route that somehow isn't in the derived permission catalog |

Validation errors (`422`) and generic unauthenticated (`401` from a missing/
invalid bearer token or cookie) follow the existing envelope's standard
shape and are not admin-specific.

## Cookies

Set on login (non-challenge outcome), verify-otp, and refresh; cleared on
logout.

| Cookie | Path | Contents | Notes |
| --- | --- | --- | --- |
| `admin_access` | `/api/v1` | access token | `httpOnly`, `SameSite=Lax`, `Secure` in production, `Max-Age` = access-token TTL |
| `admin_refresh` | `/api/v1/admins/refresh` | refresh token | `httpOnly`, `SameSite=Lax`, `Secure` in production, `Max-Age` = `REFRESH_TTL_WEB_SECONDS` |

Both cookies get an explicit `Domain` attribute if `ADMIN_COOKIE_DOMAIN` is
configured server-side. Browser clients should rely on cookies exclusively
and never read/store the tokens; send `X-Auth-Include-Tokens: 1` only from
non-browser tooling that needs the raw bearer tokens.

## `ADMIN_OTP_REQUIRED` flag semantics

- Server setting, defaults to `true` in every environment (including local
  dev) — OTP is mandatory unless explicitly turned off.
- `true`: `POST /login` never returns tokens directly; it always returns an
  OTP challenge, and the client must call `POST /verify-otp` to complete
  login and receive cookies/tokens.
- `false`: `POST /login` behaves like the pre-2FA API — returns
  `{ admin, tokens }` directly and sets cookies immediately, no challenge
  step. This mode exists solely for frontend compatibility while the admin
  web/mobile clients are migrated (tracked as a "3b" follow-up) and is
  covered by a dedicated regression test (`tests/admin-otp-login.test.ts`,
  "returns tokens directly when ADMIN_OTP_REQUIRED=false").
- Changing this flag does not affect already-issued sessions/tokens, only
  the shape of subsequent `POST /login` calls.
