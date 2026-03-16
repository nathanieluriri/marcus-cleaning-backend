# Auth0 Outage and Key Rotation Runbook

## Triggers

- Elevated token verification failures due to JWKS/key mismatch.
- Auth0 login/token endpoints failing or timing out.
- Tenant misconfiguration suspected after deployment.

## Auth0 Outage Procedure

1. Confirm outage scope:
   - check error rate on protected endpoints,
   - check Auth0 status and tenant health,
   - confirm local network/provider issue is not root cause.
2. Activate incident mode:
   - page on-call security + platform,
   - freeze non-essential deployments.
3. Preserve fail-closed behavior on token verification.
4. Communicate degraded state to stakeholders.

## JWKS/Key Rotation Failure Procedure

1. Validate token header `kid` vs fetched JWKS keys.
2. Force refresh verification path by restarting workers if cache state is stale.
3. Verify `AUTH0_ISSUER`, `AUTH0_AUDIENCE`, and domain values.
4. If required, rotate signing key in Auth0 and revalidate with smoke checks.

## Post-Recovery Validation

1. Run auth-protected smoke routes for each role.
2. Confirm alert levels return to baseline.
3. Export audit evidence for incident ticket.

## Required Artifacts

- timeline in UTC,
- failed/successful verification samples,
- config snapshots before/after remediation,
- final root cause and action items.
