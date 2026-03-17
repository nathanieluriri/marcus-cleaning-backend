# Admin Frontend Integration Guide: Audit + Related Endpoint Changes

## Purpose
This document summarizes backend changes that impact the Admin frontend, with focus on the new Audit experience and other admin APIs added/changed in the same release.

Use this as the source of truth for frontend migration.

## 1. Breaking and Important Changes

1. Audit history list/detail path changed from:
   - `GET /v1/admins/monitoring/audit`
   - `GET /v1/admins/monitoring/audit/{event_id}`
2. To:
   - `GET /v1/admins/monitoring/audit/history`
   - `GET /v1/admins/monitoring/audit/history/{event_id}`
3. Audit `event_type` values are now API-level snake_case values (example: `admin_login_failed`).
4. Audit export is now asynchronous with queued job metadata and status/download flow.
5. Onboarding queue is now strict pending only:
   - backend filter is `onboarding_status == "PENDING"` only.
   - missing/null onboarding rows are no longer auto-included.

## 2. Audit API Contract Implemented

### 2.1 List Audit Events
`GET /v1/admins/monitoring/audit/history`

Supported query params:
- `start`, `stop` (offset mode)
- `cursor` (cursor mode; if present, backend ignores offset window)
- `sort` (`asc|desc`, default `desc`)
- `actor_id`, `actor_type`
- `target_id`, `target_type`
- `endpoint`, `method`
- `status`, `event_type`, `severity`
- `request_id`, `ip`
- `from_epoch`, `to_epoch`
- `tags` (comma-separated in URL; backend parses to list)
- `include_payload` (default `false`)
- `include_related` (default `false`)

Response data shape:
- `items: AuditEvent[]`
- `pagination: { start, stop, count, total?, next_cursor, has_more }`
- `query: normalized echo of selected filters`

### 2.2 Get Single Audit Event
`GET /v1/admins/monitoring/audit/history/{event_id}`

Query params:
- `include_payload` (default `true`)
- `include_related` (default `true`)
- `redaction` (`strict|standard|none`, default `strict`)

Notes:
- `redaction=none` is restricted (non-super-admin gets `403`).

### 2.3 Audit Event Model for UI
Each row/detail uses canonical fields including:
- `id`, `timestamp`, `request_id`
- `actor { id, type, display_name, email }`
- `target { id, type, display_name }`
- `event_type`, `action`, `summary`
- `method`, `endpoint`, `status`, `http_status_code`, `severity`
- `ip_address`, `user_agent`
- `permission`, `payload_redacted`, `changes`, `related`, `tags`, `risk_score`

## 3. Audit Export Flow Implemented

### 3.1 Create Export Job
`POST /v1/admins/monitoring/audit/export`

Behavior:
- returns queued job metadata (not immediate rows)
- `download_url` is concrete and returned immediately:
  - `/v1/admins/monitoring/audit/export/{export_id}/download`

### 3.2 Poll Export Job
`GET /v1/admins/monitoring/audit/export/{export_id}`

Use this to check:
- `status`: `queued|processing|ready|failed`
- `estimated_rows`
- `download_url`
- `expires_at`

### 3.3 Download Artifact
`GET /v1/admins/monitoring/audit/export/{export_id}/download`

Behavior:
- returns CSV attachment when ready.
- returns `409` if job is not ready.
- returns `410` after expiry.

## 4. Event Type and Filter Migration

Frontend must send snake_case values for `event_type` filters (examples):
- `admin_login_succeeded`
- `admin_login_failed`
- `admin_token_refreshed`
- `admin_session_revoked`
- `permission_denied`
- `permission_template_updated`
- `permission_template_rolled_out`
- `cleaner_onboarding_reviewed`
- `monitoring_alert_acknowledged`
- `monitoring_alert_read_state_changed`
- `audit_export_requested`

Do not send old `ADMIN_*` values from frontend anymore.

## 5. Other Admin Endpoints Added/Changed (Frontend Impact)

### 5.1 Onboarding Queue
`GET /v1/admins/onboarding/queue`

Important:
- queue now strictly represents pending onboarding only (`PENDING` rows).
- expect fewer rows if legacy data had missing/null onboarding status.

### 5.2 Directory and Detail APIs
- `GET /v1/admins/customers`
- `GET /v1/admins/customers/{customer_id}`
- `GET /v1/admins/cleaners`
- `GET /v1/admins/cleaners/{cleaner_id}`

These are available for admin list/detail flows and should be used instead of synthetic client-side joins where possible.

### 5.3 Permission Template UX APIs
- `POST /v1/admins/permission-templates/{role}/preview`
- `GET /v1/admins/permission-templates/{role}/rollout-impact`

Use these for pre-save and pre-rollout confirmation UI.

### 5.4 Reporting APIs
- `GET /v1/admins/reports/users/summary`
- `GET /v1/admins/reports/users/signups-trend`

Use these instead of deriving report cards from unrelated list endpoints.

## 6. Frontend Migration Checklist

1. Replace any calls to `/monitoring/audit` list/detail with `/monitoring/audit/history` equivalents.
2. Update audit filter enums/constants to snake_case event types.
3. Update audit table parser to read:
   - `data.items`
   - `data.pagination`
   - `data.query`
4. Update export UX to async flow:
   - call create export
   - poll status endpoint
   - enable download button only when `status === "ready"`
5. Handle export error states:
   - `409` not ready
   - `410` expired (show regenerate prompt)
6. Keep filters URL-backed, including `cursor` when using cursor mode.
7. For onboarding queue page, adjust empty-state messaging to account for strict `PENDING` filtering.

## 7. Envelope and Error Handling

All endpoints continue using envelope response:
- success: `{ success, message, data, requestId }`
- error: `{ success: false, message, data, requestId }`

Validation failures return `422` with validation details.

## 8. Suggested Frontend Rollout Order

1. Audit history path + parser + enum migration.
2. Export async workflow + download flow.
3. Onboarding queue strict pending behavior updates.
4. Integrate preview/impact/reporting endpoints where needed.

