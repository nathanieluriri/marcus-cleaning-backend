# Auth Incident Response Runbook

## Scope

Use this runbook for suspicious token activity, possible account compromise, refresh-token replay, or unexpected login anomalies.

## Severity

- High: single-account replay/compromise signal with limited blast radius.
- Critical: multi-account replay surge, possible key compromise, or widespread auth bypass indicators.

## Immediate Actions (0-15 minutes)

1. Triage alert context: actor IDs, request IDs, IP/network metadata, endpoint, and token identifiers.
2. Confirm signal quality using monitoring APIs:
   - `/v1/admins/monitoring/overview`
   - `/v1/admins/monitoring/alerts`
   - `/v1/admins/monitoring/sessions/anomalies`
3. Revoke affected sessions:
   - For admin account owner: `/v1/admins/sessions/revoke-all`
   - For cleaner: `/v1/cleaners/sessions/revoke-all`
   - For customer: `/v1/settings/sessions/revoke-all`
4. Force re-authentication and MFA challenge for impacted accounts in Auth0.

## Containment (15-60 minutes)

1. Validate whether event is isolated or broad (same ASN/device pattern, same `azp`, same API route cluster).
2. If broad impact, rotate Auth0 signing keys (emergency rotation procedure).
3. Temporarily tighten session policy envs for hot containment:
   - `AUTH_SESSION_MAX_AGE_*_SECONDS`
   - `AUTH_SESSION_IDLE_TIMEOUT_*_SECONDS`
4. If compromised integration suspected, disable affected Auth0 application/client and block token issuance path.

## Recovery

1. Re-enable normal auth only after:
   - replay alerts return to baseline,
   - no unauthorized access traces remain,
   - fresh sign-ins pass expected controls.
2. Restore standard timeout policy values.
3. Notify stakeholders and affected users per incident communications policy.

## Evidence & Postmortem

Capture:

- incident timeline (UTC),
- impacted principals/accounts,
- revoked session counts,
- root cause,
- permanent preventive actions.

Target SLA:

- MTTA: <= 10 minutes
- Initial containment: <= 60 minutes
- Root cause hypothesis: <= 4 hours
