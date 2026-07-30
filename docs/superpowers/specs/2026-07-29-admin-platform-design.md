# Admin Platform (Phase 3) — Design Spec

Date: 2026-07-29. Status: approved.
Two sub-projects: **3a backend** (this repo), **3b admin frontend**
(`Marcus-cleaning-admin-frontend`). Reference implementation for patterns and
design: VisiChek (`Downloads/visicheck/visichek-app-frontend` + backend).

Decisions (user-approved): invite-only admin creation (no public signup);
admin tokens move to httpOnly cookies; 2FA = mandatory email OTP at login with
optional TOTP replacing it once enrolled; roles as access presets.

## 3a Backend

### 1. Permission enforcement
- `requireAdminPermission()` guard (wraps `requireAdmin`): resolves the request
  to a key `METHOD:/normalized/path` (path params → `{param}` placeholders) and
  checks the admin's `permissionList`. `'*'` and `isSuperAdmin` bypass.
  403 `FORBIDDEN` with details `{required}` otherwise.
- Real permission catalog generated from the mounted admin route table,
  replacing the `permission-catalog-service` stub; served by the existing
  `GET /admins/permissions/catalog`.
- Guardrail test: walk every mounted `/api/v1/admins` route; fail if any lacks
  a catalog entry or the enforcement guard. No admin route ships unenforced.
  Login/refresh/verify-otp/change-password/logout are the explicit exempt set.

### 2. Access presets (roles)
- Presets: `all_controls`, `operations_only`, `support_only`,
  `content_support`, `finance_only`. Each maps to a concrete permission-key
  list (defined in one module; `all_controls` = `['*']`).
- Admin doc gains `accessPreset: string | null`; setting a preset expands and
  stores the matching `permissionList` (custom lists remain possible:
  preset null + explicit list).
- Endpoints: `PATCH /admins/{admin_id}/access-preset` `{preset}`,
  `POST /admins/access-presets/bulk` `{adminIds[], preset}`,
  `GET /admins/access-presets` (catalog with labels/descriptions).
  `role-permission-template-service` stubs are implemented for these.
- Protections: cannot demote the last super admin; only super admins manage
  presets of other admins.

### 3. 2FA
- Login: valid credentials → create OTP challenge (6-digit code, hashed,
  10-min TTL, max 5 attempts) → email via Resend → respond
  `{otpRequired: true, otpChallengeId, method: 'email'|'totp'}` with NO tokens.
- `POST /admins/verify-otp` `{challengeId, code}` → session (cookies + body per
  §5). If TOTP is enrolled, `method: 'totp'` and the code is verified against
  the TOTP secret (30s window ±1 step) or a backup code; email is not sent.
- TOTP endpoints (bearer/cookie authed): `POST /admins/2fa/setup` → `{secret,
  otpauthUri}` (pending until verified), `POST /admins/2fa/verify` `{code}` →
  activates + returns 8 one-time backup codes (hashed at rest, shown once),
  `DELETE /admins/2fa` `{code}`, `POST /admins/2fa/backup-codes/regenerate`.
- Dev escape hatch: `OTP_DEV_CODE` accepted in non-production only; a startup
  security-posture check refuses production boot when it is set to the
  well-known default.
- Rate limits: challenge creation and verification both rate-limited; 429
  surfaces `retry_after_seconds`.

### 4. Invite-only admins
- `POST /admins/invites` `{email, fullName, accessPreset}` (super-admin or
  admin-management permission): creates the admin with a random temp password
  (hashed), `mustChangePassword: true`, `tempPasswordExpiresAt` (+72h);
  emails a styled invitation (Resend) with the temp password.
- Login with temp password follows the normal OTP flow; session responses
  include `mustChangePassword: true`; all admin endpoints except
  `POST /admins/change-password`, verify-otp, refresh and logout return 403
  `PASSWORD_CHANGE_REQUIRED` until changed.
- `POST /admins/change-password` `{currentPassword, newPassword}` clears the
  flag and revokes other sessions. Expired temp password → login rejected with
  `TEMP_PASSWORD_EXPIRED`; invite can be re-sent (regenerates temp password).
- Existing `admin-management-service` create path is superseded by invites
  (kept for compatibility but marked deprecated in the OpenAPI description).

### 5. httpOnly cookies for admins
- `POST /admins/verify-otp` and `POST /admins/refresh` set
  `admin_access` and `admin_refresh` cookies: `HttpOnly; Secure;
  SameSite=Lax; Path=/api/v1/admins` (refresh cookie path-scoped to refresh).
  Bodies still return tokens when the request carries
  `X-Auth-Include-Tokens: 1` (tooling/tests); otherwise token fields are null.
- Admin guards accept the access cookie, with `Authorization: Bearer` fallback.
- Refresh reads the refresh cookie when the body omits the token.
- Logout clears both cookies. CORS: admin origin gets
  `Access-Control-Allow-Credentials: true` with an explicit origin allowlist
  (env `ADMIN_ORIGINS`, comma-separated).
- Customer/cleaner flows unchanged.

### Testing (3a)
Vitest per feature: permission-matrix (allowed/denied/star/superadmin),
route-coverage guardrail, OTP challenge lifecycle incl. attempts/TTL/rate
limit, TOTP verify with fixed-time vectors + backup codes one-time-use,
invite → temp login → forced change → cleared, cookie flags/attributes on
responses, dev-code refusal in production posture.

## 3b Admin frontend (separate plan)

1. Login rebuilt as a two-state screen (credentials → OTP) with VisiChek's
   composition: 440px card, rounded-3xl, soft shadow, icon-leading inputs with
   brand-green focus ring, loading button with label swap and arrow, inline
   error pill, trust footer; OTP state uses a 6-box auto-advancing input with
   paste handling, spam hint, back link, 429 lockout copy. Change-password
   screen for `mustChangePassword`.
2. Boot splash `BrandedSplash` (logo overshoot entrance, wordmark fade-up,
   rotating tip card, 3px indeterminate progress bar, min-visible 1600ms,
   10s safety timeout, reduced-motion kill-switch) as the bootstrap gate;
   per-route `loading.tsx` skeletons.
3. Team page: invite modal (name/email/preset), per-row preset dropdown,
   bulk preset change, preset badges; Security settings tab with TOTP setup
   stepper (init → scan QR → verify → backup codes → done), disable dialog,
   backup-code regenerate.
4. Design pass: named z-index scale, nav descriptions + command launcher
   polish, responsive-modal/confirm-dialog/page-skeleton recipe components,
   dark-mode audit; finish Vite→Next cleanup (drop vite config, react-router,
   legacy page, stale README).
5. Auth plumbing: `credentials: 'include'` everywhere, drop localStorage
   tokens (keep a non-sensitive auth-hint flag for the synchronous guard),
   handle `mustChangePassword` and OTP states in the auth hook.

### Testing (3b)
Vitest+Testing Library: login state machine (credentials→otp→session,
lockout, back), change-password gate, access filtering with presets; one
Playwright smoke: login→OTP→dashboard with mocked API.

## Out of scope
Admin SSO, per-branch scoping, audit-log UI changes, tenant white-labelling.
