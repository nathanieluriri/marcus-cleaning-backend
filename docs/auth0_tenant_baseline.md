# Auth0 Tenant Baseline Check

Use `scripts/check_auth0_tenant_baseline.py` to detect tenant security drift in CI.

## Required Environment Variables

- `AUTH0_DOMAIN`
- `AUTH0_MGMT_CLIENT_ID`
- `AUTH0_MGMT_CLIENT_SECRET`
- `AUTH0_CLIENT_ID` (required only when checking callback/logout allowlists)
- One baseline source:
  - `AUTH0_BASELINE_ENV` (`dev`, `staging`, `prod`) for repo baselines under `security/auth0_baselines/`, or
  - `AUTH0_BASELINE_JSON`, or
  - `AUTH0_BASELINE_FILE`

## Baseline Format

```json
{
  "tenant_settings": {
    "friendly_name": "Marcus Cleaning",
    "flags.universal_login": true
  },
  "brute_force": {
    "enabled": true
  },
  "suspicious_ip_throttling": {
    "enabled": true
  },
  "breached_password": {
    "enabled": true
  },
  "guardian_enabled_factors": ["otp", "push-notification"],
  "client_callbacks": ["https://app.example.com/callback"],
  "client_allowed_logout_urls": ["https://app.example.com/logout"]
}
```

`tenant_settings`, `brute_force`, `suspicious_ip_throttling`, and `breached_password` support dotted keys.
`client_callbacks` and `client_allowed_logout_urls` are optional. If provided, the checker asserts an exact, sorted match against the Auth0 application client settings.

## Run

```bash
python3 scripts/check_auth0_tenant_baseline.py
```

## GitHub Actions

Workflow: `.github/workflows/auth0-tenant-baseline.yml`

Required secrets per environment:

- `AUTH0_DEV_DOMAIN`, `AUTH0_DEV_MGMT_CLIENT_ID`, `AUTH0_DEV_MGMT_CLIENT_SECRET`
- `AUTH0_STAGING_DOMAIN`, `AUTH0_STAGING_MGMT_CLIENT_ID`, `AUTH0_STAGING_MGMT_CLIENT_SECRET`
- `AUTH0_PROD_DOMAIN`, `AUTH0_PROD_MGMT_CLIENT_ID`, `AUTH0_PROD_MGMT_CLIENT_SECRET`

## Environment Smoke

Script: `scripts/smoke_auth0_token_issuance.py`

- Required:
  - `AUTH0_SMOKE_USER_EMAIL`
  - `AUTH0_SMOKE_USER_PASSWORD`
- It validates:
  - password login token issuance
  - Auth0 JWT verification path
  - refresh-token flow (when refresh token is returned)

Workflow: `.github/workflows/auth0-smoke.yml` (manual dispatch).

- Exit `0`: no drift.
- Exit `1`: drift detected.
- Exit `2`: execution/config error.
