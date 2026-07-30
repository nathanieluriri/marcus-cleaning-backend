# Admin Platform Backend (Phase 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin 2FA (email OTP + optional TOTP), invite-only admin creation with forced password change, httpOnly cookie sessions, access presets, and real permission enforcement over every admin route.

**Architecture:** Additive services + new guards in the existing layered structure. Enforcement is a mount-level middleware over `/api/v1/admins` (not per-route edits), driven by a catalog derived from the mounted route tables. TOTP is hand-rolled on `node:crypto` (RFC 6238 + RFC 4648 base32) — no new dependencies.

**Tech Stack:** Hono + zod-openapi, `hono/cookie` helpers (already shipped with hono), bcryptjs, node:crypto, Resend + React Email, Vitest (`vi.mock` repo-factory pattern, no Mongo).

## Global Constraints

- Branch `feature/admin-platform` off current `master`. Commit per task; NO Claude/Anthropic co-author trailers (app/CLAUDE.md).
- Envelope `ok(c, msg, data)` / `AppError(status, code, message, details)`; error code at `data.code`.
- Existing mobile (customer/cleaner) flows must be untouched; only admin surfaces change.
- Feature flag `ADMIN_OTP_REQUIRED` (env, default `'true'`): when `'false'`, login behaves exactly as today (tokens immediately) — this keeps the deployed admin frontend working until Phase 3b ships, and simplifies tests that don't target 2FA. All new 2FA tests set it true explicitly.
- Guards: `requireAdmin` is a factory — call sites use `requireAdmin()`. `principalOf(c)` reads the principal. Env type from `server/core/http-env.ts`.
- Session issuing via existing `issueSession({userId, role:'admin', device})`; hashing via `security/hash.ts` (`hashPassword`, `verifyPassword`, `sha256`, `generateRefreshToken` pattern for random secrets).
- Tests: `vitest run` from `app/`; `npm run typecheck` clean; route-registration tests via `router.routes.some(...)` pattern (tests/customer-sessions.test.ts); service tests via hoisted `vi.mock` factories (tests/password-reset.test.ts). Settings mutations in tests: seed `process.env` + `__resetSettingsCache()`.
- New env keys (all optional with safe defaults, added to `core/settings.ts` EnvSchema): `ADMIN_OTP_REQUIRED` (default 'true'), `OTP_DEV_CODE` (optional), `ADMIN_COOKIE_DOMAIN` (optional).

---

### Task 1: Admin schema + repo extensions

**Files:**
- Modify: `app/server/schemas/admin.ts`, `app/server/repositories/admin-repo.ts`
- Test: `app/tests/admin-repo-shape.test.ts` (light: AdminOut parse with new fields)

**Interfaces (produced for Tasks 2–7):**
- `AdminDoc` gains: `accessPreset?: string | null`, `mustChangePassword?: boolean`, `tempPasswordExpiresAt?: number | null` (epoch s), `totpSecret?: string | null` (base32, null until enrolled), `totpPendingSecret?: string | null`, `totpEnabledAt?: number | null`, `backupCodes?: string[]` (sha256 hashes).
- `AdminOut` gains: `accessPreset: z.string().nullable().default(null)`, `mustChangePassword: z.boolean().default(false)`, `totpEnabled: z.boolean().default(false)` (derived from `totpEnabledAt != null` in `toAdminOut`) — never expose secrets/backup hashes.
- admin-repo adds (mirroring customer-repo idioms): `updatePassword(id, hashed)`, `updateAdmin(id, patch: Partial<AdminDoc>)` ($set + lastUpdated), `listAdmins({limit, skip})`, `countSuperAdmins()`.

- [ ] TDD-light: parse test for `toAdminOut` derivation (totpEnabled true/false, defaults). Implement. Full `npm test` + typecheck green. Commit `feat(admin): schema and repo groundwork for 2FA, presets and invites`.

---

### Task 2: Email OTP login flow

**Files:**
- Create: `app/server/services/admin-otp-service.ts`, `app/server/repositories/admin-otp-repo.ts` (collection `admin_otp_challenges`)
- Modify: `app/server/services/admin-service.ts`, `app/server/routes/admins.ts`, `app/server/core/settings.ts`, `app/server/schemas/admin.ts` (login response schema)
- Create: `app/server/core/security-posture.ts` (boot check)
- Test: `app/tests/admin-otp-login.test.ts`

**Interfaces:**
- Challenge doc: `{_id, adminId, codeHash (sha256), method: 'email'|'totp', attempts: number, expiresAt (epoch s, +600), consumedAt?, dateCreated}`.
- `adminOtpService.createChallenge(admin: AdminDoc & {_id}): Promise<{challengeId, method}>` — method 'totp' when `totpEnabledAt != null` (no email, no stored code hash — verification is live); else 6-digit code (crypto-random, `randomInt(0,1e6)` zero-padded), hashed, emailed via `sendOtpEmail({to, otp})`.
- `adminOtpService.verifyChallenge({challengeId, code, device}): Promise<AdminLoginResult>` — loads challenge (404→`AUTH_INVALID_TOKEN`-style 401 `OTP_INVALID`), rejects expired (`OTP_EXPIRED` 401), increments attempts atomically, ≥5 → `OTP_LOCKED` 429 with `retry_after_seconds`; email method compares sha256; totp method delegates to Task 3's verifier (until Task 3 lands, a seam function `verifyTotpOrBackupCode` stub throwing `OTP_INVALID` — replaced in Task 3); `OTP_DEV_CODE` match accepted only when `NODE_ENV !== 'production'` and the env is set. Success: mark consumed, `issueSession`, return `{admin: toAdminOut, tokens}` like login does today.
- `POST /admins/login` behavior: credentials verified as today; when `ADMIN_OTP_REQUIRED === 'true'` respond 200 `{otpRequired: true, otpChallengeId, method}` (schema `AdminLoginChallengeData`), NO tokens, NO admin object (don't leak profile pre-2FA); flag false → legacy full response. Response schema becomes a union; document both in OpenAPI.
- `POST /admins/verify-otp` `{challengeId, code}` → full `{admin, tokens}` response (+cookies in Task 4).
- `security-posture.ts`: `assertProductionPosture()` called from `app.ts` module init — throws (refuses boot) when `NODE_ENV === 'production'` && `OTP_DEV_CODE` is set to `'123456'` or any value while... rule: in production `OTP_DEV_CODE` must be unset, period. Non-prod: anything goes.
- Temp-password expiry check hooks here too: login with `mustChangePassword && tempPasswordExpiresAt < now` → 401 `TEMP_PASSWORD_EXPIRED` before OTP challenge creation.

- [ ] TDD: challenge lifecycle (create → verify happy path; wrong code ×5 → OTP_LOCKED; expired; consumed reuse rejected; dev code in non-prod; dev code REJECTED when NODE_ENV=production; flag false → login returns tokens directly; temp-password expired rejection). Mock repos/email/session per password-reset.test.ts pattern. Full suite + typecheck. Commit `feat(admin): mandatory email OTP second factor on login`.

---

### Task 3: TOTP + backup codes

**Files:**
- Create: `app/server/security/totp.ts` (pure: base32 encode/decode, RFC 6238 HMAC-SHA1 code gen/verify with ±1 step window, otpauth URI builder), `app/server/services/admin-totp-service.ts`
- Modify: `app/server/routes/admins.ts` (4 routes), `app/server/services/admin-otp-service.ts` (real `verifyTotpOrBackupCode`)
- Test: `app/tests/totp.test.ts` (RFC 6238 Appendix B test vectors for SHA1), `app/tests/admin-totp-service.test.ts`

**Interfaces:**
- `totp.ts`: `generateSecret(): string` (20 random bytes → base32), `totpCode(secretBase32, {timestamp, step=30, digits=6}): string`, `verifyTotp(secretBase32, code, {timestamp, window=1}): boolean`, `otpauthUri({secret, accountName, issuer: 'Marcus Cleaning Admin'})`.
- Service: `setup(adminId)` → stores `totpPendingSecret`, returns `{secret, otpauthUri}`; `verify(adminId, code)` → checks against pending secret, on success promotes to `totpSecret` + `totpEnabledAt`, generates 8 backup codes (10-char base32 random, returns plaintext ONCE, stores sha256 hashes); `disable(adminId, code)` (accepts TOTP or backup code; clears all totp fields + backup codes); `regenerateBackupCodes(adminId, code)`.
- `verifyTotpOrBackupCode(admin, code)`: TOTP first; else backup-code hash match → consume (pull from array) and accept.
- Routes (guarded `requireAdmin()`): `POST /2fa/setup`, `POST /2fa/verify`, `DELETE /2fa`, `POST /2fa/backup-codes/regenerate`.

- [ ] TDD: RFC vectors (`totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'...)` — use the standard SHA-1 vectors: secret ASCII '12345678901234567890', T=59 → '287082' at 8 digits / derive 6-digit truncation accordingly), window acceptance ±1, base32 round-trip; service: setup→verify→enabled, wrong code keeps pending, backup code single-use, disable clears, login challenge method flips to 'totp' once enrolled and accepts TOTP + backup codes. Commit `feat(admin): TOTP enrollment with backup codes`.

---

### Task 4: httpOnly cookies + change-password + mustChangePassword gate

**Files:**
- Create: `app/server/security/admin-cookies.ts` (`setAdminSessionCookies(c, tokens)`, `clearAdminSessionCookies(c)`, `readAdminAccessCookie(c)`, `readAdminRefreshCookie(c)`) using `hono/cookie`
- Modify: `app/server/security/guards.ts` (admin guard: cookie fallback), `app/server/routes/admins.ts` (verify-otp/refresh set cookies; refresh reads cookie when body empty; new `POST /change-password`; logout clears cookies — extend after `registerSessionRoutes` with a cookie-clearing wrapper or register a dedicated admin logout that calls `logoutSession` then clears), `app/server/services/admin-service.ts` (`changePassword`)
- Test: `app/tests/admin-cookies.test.ts`, extend `admin-otp-login.test.ts`

**Interfaces:**
- Cookies: `admin_access` (Path=/api/v1, Max-Age=expiresIn) and `admin_refresh` (Path=/api/v1/admins/refresh, Max-Age = refresh TTL) — both `HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV==='production'`, `Domain` from `ADMIN_COOKIE_DOMAIN` when set.
- Body token fields: return tokens in the JSON body ONLY when request has header `X-Auth-Include-Tokens: 1`; otherwise `tokens: null` in body (schema nullable). (Keeps curl/tests working; browser uses cookies.)
- Admin guard: token = bearer header if present, else `admin_access` cookie (`bearer()` refactored to `tokenFrom(c)` for role==='admin').
- `POST /admins/change-password` `{currentPassword, newPassword min 8}` (guarded, EXEMPT from the mustChangePassword gate): verify current (temp) password, hash+store new, clear `mustChangePassword`/`tempPasswordExpiresAt`, `revokeOtherSessions`.
- mustChangePassword gate lives in Task 7's mount middleware (exempt set there); until Task 7, enforce inside `requireAdmin`'s admin branch? NO — keep it in Task 7 only, to avoid touching makeGuard twice. Task 4 just implements the endpoint + flag clearing.

- [ ] TDD: cookie attributes asserted on verify-otp response (`Set-Cookie` headers via `router.request`), guard accepts cookie-only request, refresh from cookie, logout clears (Max-Age=0), change-password happy + wrong-current + revokes others, body tokens null without opt-in header. Commit `feat(admin): httpOnly cookie sessions and change-password`.

---

### Task 5: Invites

**Files:**
- Create: `app/server/services/admin-invite-service.ts`, `app/server/emails/admin-invite.tsx` (props `{inviteeEmail, tempPassword, invitedByName?, loginUrl}` — styled like invitation.tsx)
- Modify: `app/server/routes/admin-core.ts` (routes `POST /invites`, `POST /invites/{admin_id}/resend`), `app/server/core/email/send.ts` (`sendAdminInviteEmail`)
- Test: `app/tests/admin-invites.test.ts`

**Interfaces:**
- `invite({email, fullName, accessPreset, invitedBy})`: 409 `EMAIL_EXISTS` if taken; temp password = 12-char base64url random; creates admin `{mustChangePassword: true, tempPasswordExpiresAt: now+72h, accessPreset, permissionList: expandPreset(accessPreset) (Task 6 module; until Task 6 lands use inline map placeholder ONLY if ordering demands — prefer implementing Task 6 first if the implementer finds it cleaner; the plan orders presets AFTER invites, so define `expandPreset` in this task in `server/security/admin-presets.ts` and Task 6 builds on it)}`; sends email with the temp password + login URL (`ADMIN_ORIGINS`/CORS first origin or env `ADMIN_LOGIN_URL` default `http://localhost:3000/login`).
- NOTE on ordering: create `server/security/admin-presets.ts` HERE with: `ADMIN_PRESETS: Record<string, {label, description, permissions: string[]}>` for `all_controls (['*'])`, `operations_only`, `support_only`, `content_support`, `finance_only` (permission keys per Task 7's key format `METHOD:/path` — populate with the real admin route keys for each category: operations = customers/cleaners/bookings/onboarding reads+writes; support = support/faq/conversations; content = banners/promotions/broadcasts; finance = payments/service-credits/payouts/reports; every preset also gets the self-service keys: profile, sessions, 2fa, change-password, permissions catalog read).
- `resend(adminId)`: only when `mustChangePassword` still true — regenerates temp password + expiry, re-emails.
- Fields sanity: full name split into first/last on first space (lastName falls back to firstName).

- [ ] TDD: invite creates with hashed temp password + flags + preset expansion; duplicate 409; resend regenerates and re-emails; resend on activated admin 409. Commit `feat(admin): invite-only admin creation with temp passwords`.

---

### Task 6: Access presets + permission templates

**Files:**
- Modify: `app/server/security/admin-presets.ts` (from Task 5), `app/server/routes/admin-core.ts`, `app/server/services/role-permission-template-service.ts` (implement stubs), `app/server/services/admin-management-service.ts`
- Test: `app/tests/admin-presets.test.ts`

**Interfaces:**
- `PATCH /admins/{admin_id}/access-preset` `{preset}` → validates preset exists, target exists; refuses changing a super admin unless caller is super admin; refuses removing the caller's own super-admin/all-controls if `countSuperAdmins() + all_controls holders` would hit zero — precise rule: cannot change preset of the last admin whose effective permissions include `'*'`. Stores `accessPreset` + expanded `permissionList`.
- `POST /admins/access-presets/bulk` `{adminIds[], preset}` — same checks per id, returns `{updated, skipped: [{id, reason}]}`.
- `GET /admins/access-presets` → `{items: [{key, label, description, permissionCount}]}`.
- `role-permission-template-service`: implement `preview` (diff current template vs proposed: added/removed arrays), `rollout` (apply template's permissions to every admin whose `accessPreset` equals the template role — template roles are the preset keys now), `rolloutImpact` (count affected admins). `getTemplate` returns the preset definition merged with any stored override.
- Existing `GET/PUT /permission-templates/{role}` routes now accept preset keys as `role`.

- [ ] TDD: preset set/expansion, last-star protection, bulk skip reasons, preview diff, rollout applies to matching admins, impact counts. Commit `feat(admin): access presets with template rollout`.

---

### Task 7: Permission enforcement middleware + catalog + guardrail

**Files:**
- Create: `app/server/security/admin-permission-guard.ts`
- Modify: `app/server/app.ts` (mount the middleware on `/api/v1/admins/*` after CORS/locale/rate-limit, BEFORE routers), `app/server/services/permission-catalog-service.ts` (real catalog from route tables)
- Test: `app/tests/admin-permission-guard.test.ts`, `app/tests/admin-route-coverage.test.ts`

**Interfaces:**
- Key format: `METHOD:/api/v1/admins/<path with {param} placeholders>` normalized from Hono's registered `:param` syntax.
- Middleware behavior (runs for every `/api/v1/admins/*` request):
  1. Skip entirely for the EXEMPT set: `POST /login`, `POST /verify-otp`, `POST /refresh`, plus OPTIONS.
  2. Authenticate: reuse `requireAdmin()` semantics (delegate to the same verification path — factor the admin token verification out of `makeGuard` or invoke the guard middleware inside). Principal set as usual so downstream `principalOf` works; downstream per-route `requireAdmin()` calls stay in place harmlessly (idempotent).
  3. mustChangePassword gate: if the admin doc has `mustChangePassword`, allow only `POST /change-password`, `GET /profile`, session routes and `POST /2fa/*`? — rule: allow `change-password`, `profile` (GET), `sessions/logout`; everything else 403 `PASSWORD_CHANGE_REQUIRED`.
  4. Permission check: superAdmin or `permissionList` contains `'*'` → pass. Else compute the request's key by matching against the catalog's route patterns (longest-match on path segments, `{param}` wildcards); no catalog entry → 403 `FORBIDDEN` (fail closed); entry present but not in the admin's list → 403 `FORBIDDEN` details `{required: key}`.
  5. Self-service keys every authenticated admin implicitly holds (not permission-gated): profile GET/PATCH-language, sessions/*, 2fa/*, change-password, `GET /permissions/catalog`, `GET /access-presets`, access request-elevation/status.
- Catalog: `permission-catalog-service.getCatalog()` now builds from the mounted routers (`admins.routes`, `adminCore.routes`, `adminFeatures...` — import the router objects, walk `.routes`, map to keys + human labels by category heuristics), cached at module level. Old static CATALOG kept as label overrides.
- Guardrail test (`admin-route-coverage.test.ts`): for every route across all admin routers, assert it is either in the EXEMPT set, the implicit self-service set, or resolvable to a catalog key. Fails when someone adds an uncatalogued admin route.
- Performance: the middleware loads the admin doc once per request (it already must for mustChangePassword); reuse the load done by guard's `retrieveAccountById`.

- [ ] TDD: allowed (key in list), denied (403 + required key), star, superadmin, exempt paths, mustChangePassword lockdown matrix, unknown-route fail-closed; coverage test green. Full suite (all prior tests must still pass — notably profile/session routes now need permissioned or implicit access in test fixtures). Commit `feat(admin): enforce permissions on every admin route`.

---

### Task 8: Verification pass

- [ ] Full `npm test` + `npm run typecheck` + `npm run lint`/build. Grep: no secrets in response schemas (totpSecret/backupCodes never in AdminOut); posture check wired in app bootstrap; `ADMIN_OTP_REQUIRED=false` path keeps legacy login test green (frontend compatibility until 3b). Update `docs/migration` or a short `docs/ADMIN_AUTH.md` describing the new flow for the frontend team (login → challenge → verify-otp, cookies, headers, error codes). Commit `chore: admin platform verification pass and auth docs`.
