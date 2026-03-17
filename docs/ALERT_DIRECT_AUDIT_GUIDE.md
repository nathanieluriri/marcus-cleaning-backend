# Direct Alert Auditing Guide

## Purpose
This guide explains how alert-to-audit correlation now works so frontend can open an alert and fetch related audit history directly.

## What Was Changed

1. Alert creation now writes an audit event linked to the alert ID.
2. Alert acknowledgement now writes an audit event linked to the alert ID.
3. Alert read-state updates now write an audit event linked to the alert ID.
4. Audit history query by `target_id=<alert_id>` now includes fallback correlation for older alerts via alert `request_id`.

## Endpoints to Use

### 1) List alerts
`GET /v1/admins/monitoring/alerts`

Use the returned alert `_id` as the investigation key.

### 2) Fetch audit history for a specific alert
`GET /v1/admins/monitoring/audit/history?target_id=<alert_id>&start=0&stop=20&sort=desc`

This now works for:
- New alerts: because audit events are written with `target.target_id = alert_id`.
- Older alerts: because backend also correlates by alert `request_id` when available.

## Audit Events You Should Expect

For a typical alert lifecycle, the history may include:
- `monitoring_alert_created`
- `monitoring_alert_acknowledged`
- `monitoring_alert_read_state_changed`
- Other causally-related events that share the same `request_id` (fallback path for older records)

## Frontend UX Recommendation

When user clicks `Investigate` on an alert:
1. Navigate to audit screen with `target_id=<alert_id>`.
2. Keep `sort=desc`, `start=0`, and `stop=20` default.
3. Show empty-state only after at least one retry/poll if alert is very recent.

## Notes on Compatibility

- `target_id` in audit history refers to audit event target ID, not always the same domain ID in every event type.
- This patch ensures alert-centric flows are first-class by explicitly linking alert IDs in alert lifecycle audit events.
- For legacy events where alert ID was not embedded, request-id correlation is applied automatically.

## Error/State Handling

- If no matching rows: return is still `200` with `items: []`.
- Query validation issues: `422` envelope with validation detail.
- Permission denial: `403`.

