# 03 — Authentication & Authorization (Unified JWT)

Decision **D4/D7**: replace the split Auth0(admin) + local(customer/cleaner) model with a **single self-issued JWT system** for all roles, designed for **one web app + two native mobile apps**.

This is the largest behavioral change in the migration. It also *simplifies* the codebase: the dual Auth0/local branching in `security/auth.py` collapses into one verification path.

## Client → audience map (D7)

| Client | Role(s) | `aud` | Refresh lifetime | Refresh storage | Token transport |
|--------|---------|-------|------------------|-----------------|-----------------|
| Admin web app | `admin` | `admin-web` | 14–30 d absolute, rotated | `HttpOnly; Secure; SameSite=Strict` cookie | cookie (refresh) + `Authorization: Bearer` (access, in-memory) |
| Customer mobile | `customer` | `customer-mobile` | ~30–90 d idle / ~180 d absolute, rotated | iOS Keychain / Android Keystore | `Authorization: Bearer` |
| Cleaner mobile | `cleaner` | `cleaner-mobile` | ~30–90 d idle / ~180 d absolute, rotated | iOS Keychain / Android Keystore | `Authorization: Bearer` |

- **Access token TTL: ~15 min for all clients.** Access TTL does not vary by client; only the refresh strategy differs.
- `aud` binds a token to one app, so a token minted for the customer app cannot be replayed against the cleaner or admin app.

> These lifetimes are vendor/practitioner consensus, not normative spec. They are configurable via env (see `11`). High-sensitivity admin actions may use a shorter access TTL.

## Tokens

### Access token (JWT, stateless)

- Library: **`jose`** (Web Crypto based, runs on Node + Edge, actively maintained).
- Algorithm: **HS256** — the backend is the only signer *and* verifier, so there is no trust boundary that asymmetric keys would protect. (If third-party verification is ever needed, switch to **EdDSA/Ed25519** + JWKS — documented as a future step in `15`.)
- Claims: `iss`, `aud` (per client), `sub` (user id), `role` (`customer|cleaner|admin`), `iat`, `exp`. Optionally `sid` (session id) to allow targeted revocation checks.
- **Verification hardening (mandatory):** always pin the algorithm allow-list and check issuer + audience.

```ts
// src/server/security/jwt.ts
import { SignJWT, jwtVerify } from 'jose'
import { settings } from '@/server/core/settings'

const secret = new TextEncoder().encode(settings.JWT_SECRET)
const ISSUER = settings.JWT_ISSUER // e.g. "marcus-backend"

export type AccessClaims = {
  sub: string
  role: 'customer' | 'cleaner' | 'admin'
  aud: 'admin-web' | 'customer-mobile' | 'cleaner-mobile'
  sid: string
}

export async function signAccessToken(c: AccessClaims): Promise<string> {
  return new SignJWT({ role: c.role, sid: c.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setAudience(c.aud)
    .setIssuedAt()
    .setExpirationTime(`${settings.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret)
}

export async function verifyAccessToken(token: string, audience: string) {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],     // allow-list, never deny-list (defeats alg=none + RS256→HS256 confusion)
    issuer: ISSUER,
    audience,
  })
  return payload
}
```

### Refresh token (opaque, server-tracked)

A refresh token must be **stateful** (so it can be rotated and revoked), so it is an opaque random handle, not a JWT.

- Generate ≥32 bytes of CSPRNG randomness; return base64url to the client.
- Store **only `sha256(token)`** in `sessions`, never the plaintext. (Plain SHA-256 is acceptable here — the value is high-entropy random, unlike a password.)
- Every refresh **rotates**: issue a new refresh token in the same family, mark the old one consumed.

## `sessions` collection (refresh-token families)

```
{
  _id,
  userId,            // owner account id
  sessionId,         // family/lineage id — one per login/device
  tokenHash,         // sha256(refreshToken), unique-indexed, never plaintext
  audience,          // admin-web | customer-mobile | cleaner-mobile
  deviceInfo,        // { userAgent, ip } captured at issue
  issuedAt,          // Date
  lastUsedAt,        // Date — for sliding/idle timeout
  expiresAt,         // Date — drives TTL index + absolute cap
  usedAt,            // Date | null — set when rotated (consumed)
  replacedBy,        // tokenHash of successor (family chain)
  revokedAt,         // Date | null — explicit invalidation
  revocationReason   // optional forensics
}
```

Indexes: unique `tokenHash`; `userId`; `sessionId`; **TTL on `expiresAt`**. Set `expiresAt` slightly beyond nominal expiry so consumed/revoked rows linger for reuse detection before the TTL sweep removes them.

## Refresh rotation + reuse detection

On each `POST /refresh` (per role, see `07`):

1. Hash the presented refresh token; **lock/find** the `sessions` row by `tokenHash`.
2. Reject if not found, or `expiresAt < now`, or `revokedAt != null`.
3. Branch on `usedAt`:
   - **`usedAt == null`** → legitimate. Mint a new refresh token (same `sessionId`), set old `usedAt = now`, `replacedBy = newHash`, update `lastUsedAt`. Issue a new access token. Return the new pair.
   - **`usedAt != null`** → the token was already consumed:
     - Within a short **grace window** (e.g. 10–30 s) *and* `replacedBy` exists → treat as a benign retry/race: return the already-issued successor; do **not** revoke.
     - Otherwise → **theft/replay**: set `revokedAt` on the **entire family** (all rows with this `sessionId`) and force re-auth.
4. Enforce **idle/sliding timeout** for mobile: if `now - lastUsedAt > idleTimeout`, reject and revoke the family.

Grace window default: keep it as small as your network tolerates (Okta uses ~30 s). Configurable via env.

> Because access tokens are stateless, revocation does not instantly kill an in-flight access token — the **short access TTL bounds the residual window**. For instant kill on sensitive paths, add an access denylist keyed by `sid` (future hardening, `15`).

## `AuthPrincipal` and verification path

`AuthPrincipal` (ported from `security/principal.py`) is the resolved caller identity placed on the request context:

```ts
type AuthPrincipal = {
  userId: string
  role: 'customer' | 'cleaner' | 'admin'
  audience: string
  sessionId: string
  scopes?: string[]
}
```

The verifier replaces the Auth0/local fork with a single path:

```
verifyAccessToken(bearer, expectedAudience)
  → load account by (role, userId)         # role/account gateway, ported
  → enforce account status (non-admin: ACTIVE)
  → enforce session policy (max-age / idle) where applicable
  → build AuthPrincipal, set on context (c.set('principal', ...))
```

Role-specific guards (ported from `verify_customer_token`, `verify_cleaner_token`, `verify_admin_token`, refresh variants) become Hono middleware factories — see `04`.

## Authorization (unchanged model)

Authorization stays **DB-driven**, exactly as today:

- **Role check** per endpoint (`customer`/`cleaner`/`admin`).
- **Account status** must be `ACTIVE` for non-admin accounts.
- **Permission list** — the route's permission key must be present in the account's `permissionList` (driven by `role_permission_templates` + rollout). Admin baseline + elevation flow preserved.
- **Super-admin bypass** preserved (static id/email), ported from `super_admin_identity_service`.
- Booking/review access checks (`booking_access_check`, `review_access_check`) port to guard functions that load the resource and assert visibility.

## Google OAuth (server-side, issue our own tokens)

Current behavior: customer/cleaner Google login via `/google/auth` + `/auth/callback`. Target flow (authorization-code + PKCE, server-side):

1. `GET /{role}/google/auth` — backend generates `state` (CSRF) + PKCE `code_verifier`, stores them in `oauth_states` (TTL ~10 min), redirects to Google with `code_challenge` (S256), `scope=openid email profile`.
2. Google redirects to `GET /{role}/auth/callback?code&state`.
3. Backend verifies `state`, exchanges `code` server-side at Google's token endpoint with `client_secret` + `code_verifier` (secret never leaves the server).
4. Backend verifies Google's **ID token** (signature vs Google JWKs, `aud` == our client id, `iss` ∈ accounts.google.com, `exp`).
5. Extract `sub` + verified `email`; provision/lookup the account; **issue our own access + refresh pair** and create a `sessions` row. Google's tokens are discarded.

## Session controls (mapped to families)

Ported endpoints (`revoke-others`, `revoke-all`, `logout`, targeted `DELETE …/sessions/{session_id}`) operate on `sessions`:

| Control | Action |
|---------|--------|
| Per-device logout | `revokedAt = now` on the current `sessionId` |
| `revoke-others` | `revokedAt = now` on all families for `userId` except current `sessionId` |
| `revoke-all` | `revokedAt = now` on all families for `userId` (incl. current) |
| Password change | triggers `revoke-all` automatically |
| Active-sessions list | query non-revoked, non-expired families for `userId` (surface device/IP/login time) |

## Env (see `11`)

`JWT_SECRET`, `JWT_ISSUER`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TTL_WEB_SECONDS`, `REFRESH_IDLE_MOBILE_SECONDS`, `REFRESH_ABSOLUTE_MOBILE_SECONDS`, `REFRESH_REUSE_GRACE_SECONDS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, plus per-role session policy carried from the old settings.

## Cross-references

- Guard middleware wiring: `04-api-layer.md`
- Auth endpoints (signup/login/refresh/oauth/sessions): `07-domain-endpoints.md`
- `sessions`/`oauth_states` collections + TTL: `02-data-model.md`
- Future asymmetric keys / access denylist: `15-open-questions-risks.md`
