# Compliance Export Validation Procedure

## Objective

Validate that auth/admin monitoring exports are access-controlled, query-filtered, and auditable.

## Preconditions

- Admin account with permission to access monitoring export endpoint.
- Non-admin account for negative-access checks.
- Test data exists in monitoring/audit store.

## Validation Steps

1. Access control checks
   - Call export endpoint as unauthorized/non-admin principal.
   - Expected result: auth/permission denied.
2. Positive export checks
   - Call export as authorized admin with bounded range and filters:
     - actor filter,
     - target filter,
     - endpoint filter,
     - date range.
   - Expected result: only matching rows returned.
3. Filter integrity checks
   - Verify rows outside filter scope are absent.
   - Verify requested limit is enforced.
4. Audit trail checks
   - Confirm export invocation itself is captured in monitoring/audit trail.
5. Redaction checks
   - Verify sensitive fields are redacted in exported payload where policy requires.

## Evidence to Capture

- Request IDs and timestamps (UTC).
- Principal used for each check.
- Export row counts and sample sanitized rows.
- Screenshots/log snippets proving deny/pass behavior.

## Exit Criteria

- Unauthorized access blocked.
- Authorized export constrained to requested filters.
- Export operation traceable in audit logs.
- Redaction policy preserved in export output.
