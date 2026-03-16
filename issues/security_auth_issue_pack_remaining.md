# Security & Auth Remaining Backlog

Last reviewed: 2026-03-16

This file tracks only unresolved security/auth backlog items after code and docs verification.

## Closed/Superseded Buckets

The following issue groups are closed for repository scope (code + automation in repo):

- ISSUE-01 Admin login/session anomaly telemetry
- ISSUE-02 Permission change audit + immutable trail foundations
- ISSUE-03 Admin account lifecycle instrumentation foundations
- ISSUE-04 Admin endpoint reliability/integrity instrumentation foundations
- ISSUE-05 Alerting + triage framework foundations
- ISSUE-06 Audit schema/governance foundations
- ISSUE-07 Auth0 token hardening baseline
- ISSUE-09 FastAPI Auth0 verifier integration + JWKS resilience
- ISSUE-10 Principal provisioning + identity linking parity

## Partially Resolved (Keep Open)

### ISSUE-08: Auth0 Tenant Security Controls & Environment Configuration

- Automated tenant drift checks for `dev`/`staging`/`prod` are implemented in CI.
  Status: done (`scripts/check_auth0_tenant_baseline.py`, `.github/workflows/auth0-tenant-baseline.yml`).
- Callback/logout allowlist assertions are implemented in baseline checks.
  Status: done (optional baseline keys `client_callbacks`, `client_allowed_logout_urls`).
- Verify Auth0 attack protection and MFA settings by automation.
  Status: done (baseline checks + environment baselines).
- Move production Auth0 secrets to secret manager and verify runtime injection policy.
  Status: pending (external runtime/ops evidence required).
- Environment smoke for token issuance/refresh.
  Status: done (`scripts/smoke_auth0_token_issuance.py`, `.github/workflows/auth0-smoke.yml`).

### ISSUE-11: Auth0 Session Lifecycle, Revocation, and Timeout Policies

- Role-based max session lifetime and idle timeout enforcement.
  Status: done (`security/auth.py` with env-configured thresholds).
- Revoke-all/logout flows backed by local token store and Auth0 management API revocation.
  Status: done (`services/auth_session_service.py`, `security/auth0_client.py`, role routes).
- Compromised-account response runbook.
  Status: done (runbook exists); drill/test execution evidence pending.

### ISSUE-12: Auth Event Observability, Runbooks, and Compliance Operations

- Outage/key-rotation incident runbooks exist.
  Status: done; dry-run evidence pending.
- MTTA/MTTR alert SLA reporting endpoint exists.
  Status: done (`/v1/admins/monitoring/alerts/sla`).
- Compliance export validation procedure exists.
  Status: done; staging execution evidence pending.

## Remaining Open Operational Gates

### ISSUE-13: Security Validation Gates (Release Blocking)

- External threat model review evidence and auth abuse/pen-test evidence.
  Status: pending (external evidence collection).
- Auth hot-path load testing evidence.
  Status: pending (external evidence collection).
- Failover drill execution evidence (JWKS mismatch, Auth0 outage, callback misconfiguration).
  Status: pending (template exists at `docs/drills/auth_drill_report_template.md`).

### ISSUE-14: Production Cutover Gate (Final)

- Production smoke evidence proving rejection of legacy/non-Auth0 token formats.
  Status: pending (production run evidence).
- Final cutover evidence bundle and post-cutover monitoring report.
  Status: pending (`docs/release_auth_cutover_gate.md` contract exists).
