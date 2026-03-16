# Admin Endpoints, Duties, Permissions, Monitoring, and Dashboard Integration Guide

This document describes the admin backend surface for frontend admin panel development.

Scope covered:
- All current admin API endpoints under `/v1/admins`
- Authentication and authorization model for admins
- Permission template management for non-admin roles
- Monitoring/audit/alerts system used by admin dashboard
- Request/response envelope, error format, and key schemas
- Admin operational duties and recommended frontend workflows

Code references used: `api/v1/admin_route.py`, `security/account_status_check.py`, `services/admin_monitoring_service.py`, `repositories/admin_monitoring_repo.py`, `schemas/admin_schema.py`, `schemas/admin_monitoring_schema.py`, `schemas/role_permission_template_schema.py`, `core/response_envelope.py`, `core/errors.py`.

## 1. Base URL, Envelope, and Common Headers

Base admin prefix:
- `/v1/admins`

All decorated responses use a standard envelope:

```json
{
  "success": true,
  "message": "...",
  "data": {},
  "requestId": "optional-request-id"
}
```

Error envelope format:

```json
{
  "success": false,
  "message": "...",
  "data": {
    "code": "AUTH_PERMISSION_DENIED",
    "details": {}
  },
  "requestId": "optional-request-id"
}
```

Global headers your frontend should read/log:
- `X-Request-ID` (trace/debug correlation)
- `X-Process-Time`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`
- `Retry-After` (on `429`)

## 2. Auth and Access Control Model

### 2.1 Admin token requirements
Protected admin routes require bearer token and admin role (`verify_admin_token`).

### 2.2 Account status enforcement
`check_admin_account_status_and_permissions` blocks non-active admins:
- `ACTIVE` => allowed
- `INACTIVE`, `SUSPENDED` => `403 AUTH_ACCOUNT_INACTIVE`

### 2.3 Permission enforcement
For non-super-admin accounts:
- Route permission key is computed as: `METHOD:/path-without-v1`
- Example: `GET:/admins/monitoring/overview`
- Admin must have this in `admin.permissionList.permissions[]`.

Permission object shape:

```json
{
  "name": "get_admin_monitoring_overview",
  "methods": ["GET"],
  "path": "/admins/monitoring/overview",
  "key": "GET:/admins/monitoring/overview",
  "description": "optional"
}
```

### 2.4 Super admin behavior
A super admin bypasses permission-list checks when either matches:
- static id: `656f7ac12b9d4f6c9e2b9f7d`
- email equals `SUPER_ADMIN_EMAIL`

### 2.5 Main auth/permission failure states
- `401 AUTH_INVALID_TOKEN`
- `403 AUTH_ROLE_MISMATCH`
- `403 AUTH_ACCOUNT_INACTIVE`
- `403 AUTH_PERMISSION_DENIED`
- `401 AUTH_PRINCIPAL_NOT_FOUND`

## 3. Admin Duties (Operational Responsibilities)

Frontend admin dashboard should support these core duties:

1. Identity and access administration
- View admins
- View own profile
- Invite/create new admin
- Remove own admin account (or session-level logout/revocation)

2. Permission governance for product roles
- Inspect assignable route permissions catalog
- Edit cleaner/customer permission templates
- Roll out template updates to all users in that role

3. Workforce quality gatekeeping
- Approve/reject cleaner onboarding
- Enforce rejection reason when status is `REJECTED`

4. Security monitoring and incident response
- Monitor auth failures/success anomalies
- Triage and acknowledge alerts
- Mark alerts read/resolved operationally
- Export audit logs for investigation/compliance

5. Session risk control
- Revoke current, other, or all sessions on suspicious activity

## 4. Endpoint Catalog (`/v1/admins`)

## 4.1 Admin Identity and Account

### `GET /v1/admins/?start={int}&stop={int}`
Purpose:
- Fetch paginated admin list.

Auth:
- Admin token + permission.

Query:
- `start` (>= 0)
- `stop` (> 0)

Returns:
- `AdminOut[]`

---

### `GET /v1/admins/profile`
Purpose:
- Fetch currently authenticated admin profile.

Returns:
- `AdminOut`

---

### `POST /v1/admins/signup`
Purpose:
- Create/invite a new admin.

Auth:
- Protected admin action.

Request body (`AdminBase`):

```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "password": "StrongPassword123!",
  "accountStatus": "ACTIVE",
  "permissionList": { "permissions": [] }
}
```

Behavior:
- Creates identity in Auth0
- Creates local admin record
- Stores inviter id in `invited_by`

Response:
- `AdminOut` with `access_token`, `refresh_token` for new admin.

---

### `DELETE /v1/admins/account`
Purpose:
- Delete currently authenticated admin account.

Response:
- Successful deletion envelope with `data: null` (service does not return payload).

## 4.2 Admin Authentication and Session Management

### `POST /v1/admins/login`
Purpose:
- Admin login.

Request body (`AdminLogin`):

```json
{
  "email": "admin@example.com",
  "password": "Secret"
}
```

Response (`AdminOut`):
- includes `access_token`, `refresh_token`.

Monitoring side effects:
- Logs success/failure event
- On success logs `ADMIN_SESSION_CREATED`

---

### `POST /v1/admins/refresh`
Purpose:
- Refresh admin tokens.

Request body (`AdminRefresh`):

```json
{
  "refresh_token": "..."
}
```

Response:
- `AdminOut` + rotated token(s)

Monitoring side effects:
- Logs refresh attempt
- On failure logs refresh failure
- If failure indicates invalid refresh reuse, token-replay alert path may trigger

---

### `POST /v1/admins/sessions/revoke-others`
Purpose:
- Revoke all sessions except current.

Response:

```json
{
  "revokedAccessSessions": 3,
  "revokedRefreshSessions": 3
}
```

---

### `POST /v1/admins/sessions/revoke-all`
Purpose:
- Revoke all current admin sessions.

Response:
- Same counts as above.

---

### `POST /v1/admins/sessions/logout`
Purpose:
- Revoke current session only.

Response:
- Same counts shape.

## 4.3 Permission Governance (Cleaner/Customer)

### `GET /v1/admins/permission-templates/{role}`
Roles:
- `cleaner` or `customer`

Response (`RolePermissionTemplateView`):

```json
{
  "role": "cleaner",
  "permissionList": {
    "permissions": [
      {
        "name": "cleaner_profile_read",
        "methods": ["GET"],
        "path": "/cleaners/me",
        "key": "GET:/cleaners/me",
        "description": "Read own cleaner profile"
      }
    ]
  },
  "source": "template",
  "updated_by": "admin_id",
  "date_created": 1710000000,
  "last_updated": 1710000000
}
```

`source`:
- `template` => custom template exists in DB
- `default` => fallback from code defaults

---

### `PUT /v1/admins/permission-templates/{role}`
Purpose:
- Replace role permission template.

Body (`RolePermissionTemplateUpdate`):

```json
{
  "permissionList": {
    "permissions": [
      {
        "name": "customer_profile_read",
        "methods": ["GET"],
        "path": "/customers/me",
        "key": "GET:/customers/me",
        "description": "Read own customer profile"
      }
    ]
  }
}
```

Side effect:
- Emits `ADMIN_PERMISSION_TEMPLATE_CHANGED` audit event with before/after hashes.

---

### `POST /v1/admins/permission-templates/{role}/rollout`
Purpose:
- Apply current template (or default if none) to all users in that role.

Response (`RolePermissionRolloutOut`):

```json
{
  "role": "customer",
  "source": "template",
  "matched_count": 420,
  "modified_count": 390
}
```

Side effect:
- Emits `ADMIN_PERMISSION_ROLLOUT` event.

---

### `GET /v1/admins/permissions/catalog`
Purpose:
- Retrieve assignable permission catalog generated from routes.

Important:
- Catalog excludes `/v1/admins/*` routes.
- Intended for building cleaner/customer permission templates.

Response (`PermissionCatalogOut`):
- `grouped[]` for UI grouped views
- `flat.permissions[]` for direct assignment and diff tooling

## 4.4 Cleaner Onboarding Review Duty

### `PATCH /v1/admins/cleaners/{cleaner_id}/onboarding-review`
Purpose:
- Approve or reject cleaner onboarding.

Body (`CleanerOnboardingReviewRequest`):

```json
{
  "status": "APPROVED",
  "rejection_reason": null
}
```

Validation:
- If `status=REJECTED`, `rejection_reason` is required.
- If `status=APPROVED`, backend validates cleaner profile completeness.

Side effects:
- Updates cleaner onboarding status
- Emits `ADMIN_ONBOARDING_REVIEW_ACTION`
- Emits warning alert if rejected without reason (safety guard)

## 4.5 Monitoring and Security Analytics

### `GET /v1/admins/monitoring/overview`
Returns `AdminMonitoringOverviewOut`:

```json
{
  "login_failures_last_hour": 12,
  "login_success_last_hour": 95,
  "refresh_failures_last_hour": 4,
  "open_alert_count": 6,
  "high_alert_count": 2,
  "critical_alert_count": 1,
  "active_admin_sessions": 8,
  "suspicious_login_successes_last_day": 2
}
```

---

### `GET /v1/admins/monitoring/auth/heatmap?days=14`
Returns `AuthHeatmapOut`:

```json
{
  "items": [
    {
      "day_of_week": 1,
      "hour_of_day": 10,
      "success_count": 25,
      "failure_count": 5
    }
  ]
}
```

---

### `GET /v1/admins/monitoring/permissions/denied-top?hours=24&limit=10`
Returns `DeniedPermissionsTopOut`:

```json
{
  "items": [
    {
      "permission_key": "GET:/admins/monitoring/overview",
      "deny_count": 14,
      "admins": ["admin_id_1", "admin_id_2"]
    }
  ]
}
```

---

### `GET /v1/admins/monitoring/sessions/anomalies`
Returns `SessionAnomaliesOut`:

```json
{
  "active_sessions_by_admin": {
    "admin_id_1": 3
  },
  "global_active_sessions": 10,
  "long_lived_session_count": 2,
  "recent_session_spike_detected": false
}
```

---

### `GET /v1/admins/monitoring/alerts/sla?hours=24`
Returns `AlertSLAOut`:

```json
{
  "mtta_seconds": 180.5,
  "mttr_seconds": 1200.2,
  "acknowledged_count": 11,
  "resolved_count": 7
}
```

---

### `GET /v1/admins/monitoring/alerts?status=open&unreadOnly=true&start=0&stop=20`
Returns `SecurityAlertOut[]`.

Alert item shape includes:
- `id`, `rule_key`, `dedup_key`, `severity`, `title`, `summary`, `details`
- `status`, `is_read`
- `ack_owner_id`, `ack_at`
- `last_fired_at`, `date_created`

---

### `PATCH /v1/admins/monitoring/alerts/{alert_id}/read`
Body (`AlertReadIn`):

```json
{ "is_read": true }
```

Behavior:
- toggles read state
- sets `read_at` when true

---

### `PATCH /v1/admins/monitoring/alerts/{alert_id}/ack`
Body (`AlertAcknowledgeIn`):

```json
{ "ack": true }
```

Behavior:
- `ack=true` => `ack_owner_id=current_admin_id`, sets `ack_at`
- `ack=false` => clears `ack_owner_id`, clears `ack_at`

---

### `POST /v1/admins/monitoring/audit/export`
Body (`AuditExportRequest`):

```json
{
  "actor_id": "optional",
  "target_id": "optional",
  "endpoint": "optional-endpoint-name",
  "start_epoch": 1700000000,
  "end_epoch": 1700600000,
  "limit": 500
}
```

Returns `AuditExportOut`:

```json
{
  "items": [
    {
      "id": "...",
      "event_type": "ADMIN_LOGIN_FAILURE",
      "severity": "warning",
      "actor": {},
      "target": {},
      "request": {},
      "status_code": 401,
      "reason": "Invalid credentials",
      "details": {},
      "payload_hash": "...",
      "date_created": 1710000000,
      "date_created_iso_utc": "2026-03-16T00:00:00Z",
      "prev_hash": "...",
      "event_hash": "...",
      "stream_key": "ADMIN_LOGIN_FAILURE:unknown"
    }
  ]
}
```

## 5. Monitoring Event Taxonomy (What Gets Logged)

`MonitoringEventType` values defined by the backend schema (most are emitted by current flows):
- `ADMIN_LOGIN_ATTEMPT`
- `ADMIN_LOGIN_SUCCESS`
- `ADMIN_LOGIN_FAILURE`
- `ADMIN_REFRESH_ATTEMPT`
- `ADMIN_REFRESH_FAILURE`
- `ADMIN_REFRESH_ANOMALY`
- `ADMIN_SESSION_CREATED`
- `ADMIN_SESSION_REVOKED`
- `ADMIN_TOKEN_REPLAY_SUSPECTED`
- `ADMIN_PERMISSION_DENIED`
- `ADMIN_PERMISSION_TEMPLATE_CHANGED`
- `ADMIN_PERMISSION_ROLLOUT`
- `ADMIN_ONBOARDING_REVIEW_ACTION`

Event storage details:
- Stored in `admin_monitor_events`
- Includes hash-chain fields (`prev_hash`, `event_hash`) per stream for tamper-evidence
- `stream_key` is `{event_type}:{actor_id|unknown}`

## 6. Security Alerts: Rules and Trigger Intent

The backend automatically raises alerts for these conditions:
- Possible brute-force login activity
- Suspicious success after repeated failures
- Impossible travel (geo distance jump)
- First-seen device fingerprint
- First-seen network/ASN
- High concurrent sessions per admin
- Global admin session creation spike
- Repeated refresh failures
- Rapid refresh token churn
- Possible token replay
- Onboarding rejection missing reason

Severity levels:
- `info`, `warning`, `high`, `critical`

Dedup/cooldown behavior:
- Alerts deduplicated by `dedup_key`
- Re-fires inside cooldown update existing alert; may not create new row
- Cooldowns configurable by env and severity

Notification channels (if configured):
- Webhook (`ADMIN_MONITORING_ALERT_WEBHOOK_URL`)
- Email (`ADMIN_MONITORING_ALERT_EMAIL_RECIPIENTS`)

Delivery attempt logs stored in:
- `admin_alert_delivery_logs`

## 7. Dashboard Requirements Checklist (Frontend)

Minimum admin dashboard modules to implement:

1. Overview cards
- login failures last hour
- login successes last hour
- refresh failures last hour
- open/high/critical alerts
- active sessions

2. Auth heatmap
- day-of-week vs hour matrix
- success/failure counts

3. Alert center
- list, filter (`status`, `unreadOnly`), pagination (`start`, `stop`)
- ack/unack
- read/unread
- severity badges
- rule_key and dedup grouping visibility

4. Session risk panel
- active sessions by admin
- long-lived sessions estimate
- recent spike flag
- actions: revoke current / others / all

5. Permission governance UI
- permission catalog explorer
- role template editor (cleaner/customer)
- rollout with impact confirmation (`matched_count`, `modified_count`)

6. Audit explorer/export
- filters: actor, target, endpoint, time range, limit
- export and downloadable JSON/CSV transformation on frontend if needed

7. Cleaner onboarding moderation queue integration
- approve/reject action form
- mandatory rejection reason UX
- audit trace linkback

## 8. Frontend Implementation Rules

1. Always persist and show `requestId` for failed operations.
2. Standardize unauthorized handling:
- `401` => force re-auth
- `403 AUTH_PERMISSION_DENIED` => show permission-specific block UI
- `403 AUTH_ACCOUNT_INACTIVE` => show account disabled state
3. Handle `429` with `Retry-After` and exponential backoff.
4. Do optimistic UI only for read/ack toggles when rollback is implemented.
5. For destructive/security actions (revoke-all, rollout), require confirmation modal.
6. Treat `limit`/`start`/`stop` as server authority for pagination.

## 9. Core Schemas Quick Reference

### AdminOut

```json
{
  "_id": "string",
  "full_name": "string",
  "email": "admin@example.com",
  "password": "",
  "accountStatus": "ACTIVE",
  "permissionList": { "permissions": [] },
  "auth_provider": "auth0",
  "auth_subject": "auth0|...",
  "email_verified": true,
  "last_auth_at": 1710000000,
  "date_created": 1710000000,
  "last_updated": 1710000000,
  "access_token": "jwt",
  "refresh_token": "token"
}
```

### PermissionList

```json
{
  "permissions": [
    {
      "name": "string",
      "methods": ["GET"],
      "path": "/resource/path",
      "key": "GET:/resource/path",
      "description": "optional"
    }
  ]
}
```

### MonitoringEventOut

```json
{
  "_id": "string",
  "event_type": "ADMIN_LOGIN_FAILURE",
  "severity": "warning",
  "actor": {
    "actor_id": "string",
    "actor_role": "admin",
    "actor_email": "a***n@example.com"
  },
  "target": {
    "target_id": "string",
    "target_type": "admin"
  },
  "request": {
    "request_id": "string",
    "event_id": "uuid",
    "endpoint": "endpoint_function_name",
    "method": "POST",
    "path": "/v1/admins/login",
    "ip": "string",
    "ip_range": "string",
    "user_agent": "string",
    "fingerprint": "string",
    "geo_hint": "City, Country",
    "asn": "AS...",
    "network": "x.x.x.x/yy"
  },
  "status_code": 401,
  "reason": "string",
  "payload_hash": "sha256",
  "details": {},
  "date_created": 1710000000,
  "date_created_iso_utc": "2026-03-16T00:00:00Z",
  "prev_hash": "sha256",
  "event_hash": "sha256",
  "stream_key": "ADMIN_LOGIN_FAILURE:unknown"
}
```

### SecurityAlertOut

```json
{
  "_id": "string",
  "rule_key": "admin_bruteforce_window",
  "dedup_key": "admin_bruteforce:...",
  "severity": "high",
  "title": "Possible brute-force login activity",
  "summary": "Detected ...",
  "details": {},
  "actor_id": "string",
  "target_id": "string",
  "request_id": "string",
  "status": "open",
  "is_read": false,
  "ack_owner_id": null,
  "ack_at": null,
  "last_fired_at": 1710000000,
  "date_created": 1710000000
}
```

## 10. Important Notes and Known Behaviors

1. `GET /v1/admins/permissions/catalog` intentionally excludes admin routes; this is for non-admin template assignment.
2. Event timestamps are Unix epoch seconds; convert to local time in UI.
3. Some metrics are approximations by design (example: long-lived session count logic).
4. The field `suspicious_login_successes_last_day` is currently derived from open high-severity alert count in code, not a strict 24h bounded event count.
5. `read_at` is used as resolution proxy in SLA computation (`mttr_seconds`).

## 11. Suggested Frontend Page Map

- `/admin/overview`
- `/admin/security/alerts`
- `/admin/security/sessions`
- `/admin/security/audit`
- `/admin/permissions/catalog`
- `/admin/permissions/templates`
- `/admin/onboarding/cleaners`
- `/admin/team/admins`

This mapping aligns to backend responsibilities and keeps governance, monitoring, and operations clearly separated.
