# Auth Production Cutover Gate

## Blocking Criteria

All checks below must pass before enabling production Auth0-only cutover.

1. Security validation gate report is PASS.
2. Auth0 tenant baseline workflow passes for `dev`, `staging`, and `prod`.
3. Auth0 smoke workflow passes for target environment.
4. No unresolved high/critical auth/security risks in active register.
5. Drill evidence attached:
   - outage scenario,
   - key rotation/JWKS mismatch,
   - callback misconfiguration,
   - compromised account response.

## Required Evidence Bundle

- `artifacts/security_validation_gate_report.json`
- Auth0 baseline workflow run links + logs.
- Auth0 smoke workflow run link + logs.
- Drill reports from `docs/drills/` templates.
- Compliance export validation output.

## Cutover Decision Record

- Decision date/time (UTC):
- Approvers:
- Risks accepted:
- Rollback owner:
- Rollback trigger conditions:
