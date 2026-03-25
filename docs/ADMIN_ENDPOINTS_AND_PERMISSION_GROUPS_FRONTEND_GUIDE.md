# Admin API + Permission Groups Frontend Guide

Audience: frontend engineers building admin console authorization, navigation, and reviewer workflows.

## 1) What This Document Covers

- Full admin endpoint inventory (core admin + admin feature modules).
- Route protection model and frontend guard expectations.
- Request/response schemas used by admin auth and permission workflows.
- Built-in permission groups (`admin`, `super_admin`).
- Implemented specialized permission groups for workload segmentation (concierge, promo, monitoring, etc.).

## 2) Route Protection Model

All routes are under `"/v1/admins"` unless stated otherwise.

### Access classes

- `PUBLIC_ADMIN_AUTH`: no admin token required.
  - `POST /v1/admins/login`
  - `POST /v1/admins/refresh`
- `CURRENTLY_PUBLIC_CONFIGURATION`: currently no dependency guard in route declaration.
  - `GET /v1/admins/access/permission-groups`
- `ADMIN_AUTH_REQUIRED`: requires valid admin token, active account status, and permission check.
  - Most admin routes in this guide.
- `MAIN_SUPER_ADMIN_ONLY`: requires admin auth + caller email must match `SUPER_ADMIN_EMAIL` from environment.
  - `DELETE /v1/admins/{admin_id}`

### Permission check behavior

For non-super-admin accounts:

- Permission key format: `METHOD:/normalized/path` (example: `GET:/admins/profile`).
- Access granted if either:
  - matching `permission.key`, or
  - matching endpoint function name + HTTP method.
- Super admin bypass:
  - static id match or env super admin email match bypasses permission list checks.

## 3) Key Frontend Schemas

## 3.1 Admin Auth Payloads

### `POST /v1/admins/signup` request

```json
{
  "full_name": "Jane Admin",
  "email": "jane@example.com",
  "password": "PlaintextSentToAuth0AsIs"
}
```

### `POST /v1/admins/login` request

```json
{
  "email": "jane@example.com",
  "password": "Secret#12345"
}
```

### `POST /v1/admins/refresh` request

```json
{
  "refresh_token": "long_refresh_token"
}
```

### Typical admin auth response shape (`AdminOut`)

```json
{
  "_id": "admin_id",
  "id": "admin_id",
  "full_name": "Jane Admin",
  "email": "jane@example.com",
  "accountStatus": "ACTIVE",
  "permissionList": {
    "permissions": [
      {
        "name": "get_my_admin",
        "methods": ["GET"],
        "path": "/admins/profile",
        "key": "GET:/admins/profile",
        "description": "Admin profile fetched successfully"
      }
    ]
  },
  "auth_provider": "auth0",
  "auth_subject": "auth0|...",
  "email_verified": true,
  "last_auth_at": 1774056000,
  "access_token": "jwt_or_null",
  "refresh_token": "token_or_null",
  "date_created": 1774056000,
  "last_updated": 1774056000
}
```

## 3.2 Elevation + Permission Group Schemas

### `POST /v1/admins/access/request-elevation`

```json
{
  "reason": "Need access to pricing and promo management",
  "requestedPermissions": [
    "GET:/admins/pricing-rules",
    "POST:/admins/promo-codes"
  ],
  "requestedPermissionGroups": [
    "pricing_manager",
    "promo_handler"
  ]
}
```

Response:

```json
{
  "requestId": "object_id",
  "status": "PENDING",
  "message": "Elevation request submitted"
}
```

### `GET /v1/admins/access/request-elevation/status`

Returns latest request for current admin:

```json
{
  "requestId": "object_id_or_null",
  "status": "NONE | PENDING | APPROVED | REJECTED",
  "requestedPermissions": [],
  "requestedPermissionGroups": [],
  "grantedPermissions": [],
  "reason": null,
  "decisionNote": null,
  "reviewedBy": null,
  "reviewedAt": null,
  "dateCreated": null,
  "lastUpdated": null
}
```

### `GET /v1/admins/access/permission-groups`

```json
{
  "builtIn": [
    {
      "id": "admin",
      "name": "admin",
      "description": "Default admin permission set",
      "permissions": ["..."],
      "type": "built_in"
    }
  ],
  "custom": [
    {
      "id": "object_id",
      "name": "promo_handler",
      "description": "Promo operations",
      "permissions": ["GET:/admins/promo-codes"],
      "type": "custom",
      "createdBy": "admin_id",
      "dateCreated": 1774056000,
      "lastUpdated": 1774056000
    }
  ]
}
```

### `POST /v1/admins/access/permission-groups`

```json
{
  "name": "promo_handler",
  "description": "Promo operations",
  "permissions": [
    "GET:/admins/promo-codes",
    "POST:/admins/promo-codes",
    "PATCH:/admins/promo-codes/{id}"
  ]
}
```

### Reviewer decision payload

`PATCH /v1/admins/access/requests/{request_id}/decision`

```json
{
  "decision": "APPROVED",
  "grantedPermissions": [
    "GET:/admins/promo-codes",
    "PATCH:/admins/promo-codes/{id}"
  ],
  "note": "Approved with limited write scope"
}
```

## 3.3 Permission Catalog Schema

`GET /v1/admins/permissions/catalog` is the frontend source for route-to-permission metadata.

```json
{
  "grouped": [
    {
      "resource": "promo_codes",
      "featurePurpose": "Manages discount codes and their validation/eligibility configuration.",
      "routes": [
        {
          "resource": "promo_codes",
          "method": "GET",
          "path": "/v1/admins/promo-codes",
          "normalized_path": "/admins/promo-codes",
          "key": "GET:/admins/promo-codes",
          "endpoint_name": "list_admin_promo_codes",
          "summary": "Promo code list fetched successfully",
          "description": "Promo code list fetched successfully",
          "requires_auth": true
        }
      ]
    }
  ],
  "flat": {
    "permissions": [
      {
        "name": "list_admin_promo_codes",
        "methods": ["GET"],
        "path": "/admins/promo-codes",
        "key": "GET:/admins/promo-codes",
        "description": "Promo code list fetched successfully"
      }
    ]
  }
}
```

## 4) Core Admin Endpoint Matrix

All below are `ADMIN_AUTH_REQUIRED` unless marked otherwise.

## 4.1 Identity + Sessions

- `POST /v1/admins/login` (`PUBLIC_ADMIN_AUTH`): authenticate admin credentials.
- `POST /v1/admins/refresh` (`PUBLIC_ADMIN_AUTH`): refresh tokens.
- `GET /v1/admins/profile`: fetch signed-in admin profile and assigned permissions.
- `POST /v1/admins/sessions/logout`: revoke current session.
- `POST /v1/admins/sessions/revoke-others`: revoke all sessions except current.
- `POST /v1/admins/sessions/revoke-all`: revoke all sessions for current identity.

## 4.2 Admin Account Management

- `POST /v1/admins/signup`: create new admin using Auth0 + local record sync.
- `GET /v1/admins`: list admins.
- `DELETE /v1/admins/account`: self-delete current admin (with Auth0 delete attempt + local delete fallback logic).
- `DELETE /v1/admins/{admin_id}` (`MAIN_SUPER_ADMIN_ONLY`): delete another admin.

## 4.3 Access Governance

- `GET /v1/admins/permissions/catalog`: discover all permission keys and feature metadata.
- `GET /v1/admins/access/permission-groups` (`CURRENTLY_PUBLIC_CONFIGURATION`): list built-in + custom groups.
- `POST /v1/admins/access/permission-groups`: create custom group.
- `POST /v1/admins/access/request-elevation`: submit permission elevation request.
- `GET /v1/admins/access/request-elevation/status`: current admin request status.
- `GET /v1/admins/access/requests`: reviewer queue.
- `PATCH /v1/admins/access/requests/{request_id}/decision`: approve/reject with optional edited grants.

## 4.4 Role Permission Templates (Cleaner/Customer)

- `GET /v1/admins/permission-templates/{role}` where role in `cleaner|customer`.
- `PUT /v1/admins/permission-templates/{role}`.
- `POST /v1/admins/permission-templates/{role}/preview`.
- `POST /v1/admins/permission-templates/{role}/rollout`.
- `GET /v1/admins/permission-templates/{role}/rollout-impact`.

## 4.5 Directory + Onboarding

- `GET /v1/admins/customers`
- `GET /v1/admins/customers/{customer_id}`
- `GET /v1/admins/customers/{customer_id}/places`
- `POST /v1/admins/customers/{customer_id}/places`
- `GET /v1/admins/cleaners`
- `GET /v1/admins/cleaners/{cleaner_id}`
- `GET /v1/admins/users/autocomplete`
- `GET /v1/admins/onboarding/queue`
- `PATCH /v1/admins/cleaners/{cleaner_id}/onboarding-review`

## 4.6 User Search for Concierge/Support

- `GET /v1/admins/users/autocomplete?q={text}&limit={n}`

Purpose:

- Returns both `customers[]` and `cleaners[]` in one call for admin picker components.
- Supports partial matching on `email`, `firstName`, `lastName`, and exact `_id` lookup.
- Includes cleaner eligibility field `allow_admin_selection` so concierge flow can prevent non-selectable cleaner picks.

Response shape:

```json
{
  "query": "john",
  "customers": [
    {
      "id": "customer_object_id",
      "_id": "customer_object_id",
      "role": "customer",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "onboarding_status": null,
      "allow_admin_selection": null
    }
  ],
  "cleaners": [
    {
      "id": "cleaner_object_id",
      "_id": "cleaner_object_id",
      "role": "cleaner",
      "firstName": "Jane",
      "lastName": "Cleaner",
      "email": "jane@example.com",
      "onboarding_status": "APPROVED",
      "allow_admin_selection": true
    }
  ]
}
```

## 4.7 Monitoring + Audit + Reporting

- `GET /v1/admins/monitoring/overview`
- `GET /v1/admins/monitoring/auth/heatmap`
- `GET /v1/admins/monitoring/permissions/denied-top`
- `GET /v1/admins/monitoring/sessions/anomalies`
- `GET /v1/admins/monitoring/alerts/sla`
- `GET /v1/admins/monitoring/alerts`
- `PATCH /v1/admins/monitoring/alerts/{alert_id}/read`
- `PATCH /v1/admins/monitoring/alerts/{alert_id}/ack`
- `POST /v1/admins/monitoring/audit/export`
- `GET /v1/admins/monitoring/audit/export/{export_id}`
- `GET /v1/admins/monitoring/audit/export/{export_id}/download`
- `GET /v1/admins/monitoring/audit/history`
- `GET /v1/admins/monitoring/audit/history/{event_id}`
- `GET /v1/admins/reports/users/summary`
- `GET /v1/admins/reports/users/signups-trend`

## 5) Admin Feature Modules (Detailed)

Each module below is mounted under `/v1/admins` and guarded by admin auth + permission checks.

## 5.1 Service Definitions

Base path: `/v1/admins/service-definitions`

Purpose:

- Defines the canonical cleaning service catalog used by booking and pricing flows.
- Controls service labels and baseline duration metadata.

Endpoints:

- `GET /`
- `GET /{id}`
- `POST /`
- `PATCH /{id}`
- `DELETE /{id}`

Schema fields (`ServiceDefinitionBase`):

- `service_key`, `display_name`, `base_duration_minutes`, `is_active`, `notes`

Frontend notes:

- Use for service-management screens and onboarding of new service offerings.
- `is_active=false` should hide service from selection experiences without hard deletion.

## 5.2 Add-on Catalog

Base path: `/v1/admins/add-ons`

Purpose:

- Maintains optional add-ons attached to base service bookings.
- Acts as add-on pricing source for admin-facing operations tools.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `addon_key`, `display_name`, `price_minor`, `currency`, `is_active`, `notes`

Frontend notes:

- Use for add-on CRUD and activation controls.
- Prefer soft-disable with `is_active` for historical reporting continuity.

## 5.3 Dynamic Pricing Rules

Base path: `/v1/admins/pricing-rules`

Purpose:

- Defines conditional pricing multipliers by zone/time/rule priority.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `rule_name`, `rule_type`, `multiplier`, `priority`, `zone_codes`, `day_of_week`, `start_hour`, `end_hour`, `is_active`

Frontend notes:

- Display priority clearly because rule order affects effective pricing.
- Surface active windows to explain quote behavior during support triage.

## 5.4 Service Area Boundaries

Base path: `/v1/admins/service-areas`

Purpose:

- Defines where services are operationally allowed and how regions are grouped.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `zone_code`, `display_name`, `zip_codes`, `boundary_geojson`, `is_active`

Frontend notes:

- Use in geo-management console and coverage troubleshooting tools.
- Render geojson and zip-code metadata side by side for operator confidence.

## 5.5 Cleaner Skill/Equipment Tags

Base path: `/v1/admins/cleaner-tags`

Purpose:

- Captures cleaner skills/tools and verification state for matching and QA.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `cleaner_id`, `tag`, `tag_type`, `is_verified`, `verified_by_admin_id`

Frontend notes:

- Tag verification workflows should expose `verified_by_admin_id` attribution.
- Use tag type chips to separate skills, equipment, and certifications.

## 5.6 Availability Overrides

Base path: `/v1/admins/availability-overrides`

Purpose:

- Allows temporary deviations from normal cleaner availability (blocking/unblocking windows).

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `cleaner_id`, `start_epoch`, `end_epoch`, `override_type`, `reason`, `is_active`

Frontend notes:

- Useful for urgent reschedule support and workforce operations controls.
- Keep override reason mandatory in UI for audit readability.

## 5.7 Promo Codes

Base path: `/v1/admins/promo-codes`

Purpose:

- Manages discount campaigns and redemption lifecycle controls.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `code`, `discount_type`, `discount_value`, `max_redemptions`, `valid_from_epoch`, `valid_to_epoch`, `is_active`

Frontend notes:

- Display active/expired windows from epoch fields.
- Show discount type/value together to avoid operator mistakes.

## 5.8 Service Credits

Base path: `/v1/admins/service-credits`

Purpose:

- Ledger for customer credit grants and adjustments tied to bookings/payments.

Endpoints:

- `GET /`
- `GET /{id}`
- `POST /`
- `POST /grant`
- `GET /balance/{customer_id}`
- `PATCH /{id}`
- `DELETE /{id}`

Schema fields:

- `customer_id`, `amount_minor`, `currency`, `entry_type`, `source`, `booking_id`, `payment_id`, `note`

Frontend notes:

- Use `/balance/{customer_id}` for quick support-side balance lookup.
- Show links to booking/payment context when present.

## 5.9 Payout Adjustments

Base path: `/v1/admins/payout-adjustments`

Purpose:

- Records and tracks manual cleaner payout corrections.

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Schema fields:

- `cleaner_id`, `amount_minor`, `currency`, `adjustment_type`, `booking_id`, `reason`, `approved`

Frontend notes:

- Separate pending vs approved views for finance workflow clarity.
- Keep reason prominent for reconciliation and reviewer context.

## 5.10 Chat Interventions

Base path: `/v1/admins/chat-interventions`

Endpoints: `GET /`, `GET /{id}`, `POST /`, `PATCH /{id}`, `DELETE /{id}`

Feature meaning:

- Used when admins step into customer-cleaner chat threads for moderation, safety, dispute handling, or escalation.

Schema fields:

- `thread_id`, `customer_id`, `cleaner_id`, `action`, `note` (`admin_id` is token-derived server-side)

Frontend notes:

- Treat this as moderation/event log tied to dispute and safety operations.
- Action taxonomy should be standardized in UI dropdowns.

## 5.11 System Broadcasts

Base path: `/v1/admins/broadcasts`

Purpose:

- Creates platform-wide or audience-targeted announcements and handles dispatch lifecycle.

Endpoints:

- `GET /`
- `GET /{id}`
- `POST /`
- `POST /dispatch`
- `PATCH /{id}`
- `DELETE /{id}`

Schema fields:

- `audience`, `channel`, `title`, `message`, `schedule_epoch`, `status`

Frontend notes:

- Use `POST /dispatch` for send action from draft/queued state.
- Show schedule and status transitions to avoid duplicate sends.

## 5.12 Concierge Bookings

Base path: `/v1/admins/concierge-bookings`

Purpose:

- Enables admin-assisted booking creation for customers in support/concierge workflows.
- Persists a concierge tracking record linked to the created booking.

Endpoints:

- `GET /`
- `GET /{id}`
- `POST /`
- `POST /create-booking`
- `PATCH /{id}`
- `DELETE /{id}`

Concierge tracking schema fields:

- `customer_id`, `booking_id`, `note`, `status` (`admin_id` actor attribution is token-derived)

`POST /create-booking` request schema:

- Uses `AdminConciergeCreateBookingRequest`.
- This schema is intentionally the same as booking creation schema (`BookingBase`).
- Actor admin identity is derived from authenticated token context, not request body.

Required data for concierge submit:

- `customer_id`, `cleaner_id`, `place_id`, `service`, `duration`, `schedule`, `extras`, `custom_details`.

Server-side behavior:

- Uses the same booking pipeline as regular booking creation (customer/cleaner existence checks, payment transaction creation, quote calculation, and booking persistence).
- Enforces cleaner eligibility by requiring `allow_admin_selection = true` on selected cleaner.
- Creates concierge tracking record after booking creation succeeds.

Frontend notes:

- This endpoint is the concierge "final submit" action.
- Use same UX sequencing as customer flow (service -> cleaner -> add-ons), then submit once using booking-shape payload.
- Cleaner selection step must only allow cleaners where `allow_admin_selection` is `true`.
- Treat server quote/payment pipeline as authoritative for final monetary values.
- Booking and concierge statuses are system-owned; clients should not send lifecycle status writes.

Recommended modal sequence:

1. Customer step:
   - Query `GET /v1/admins/users/autocomplete?q=...`.
   - Render only `customers[]` candidates.
   - Query `GET /v1/admins/customers/{customer_id}/places` to preload saved `PlaceOut` options.
   - Show manual place fallback only when places are unavailable (`[]`, fetch error, or permission denial).
   - In fallback mode:
     - search location using places autocomplete,
     - select a location result and capture `place_id`,
     - resolve details if needed,
     - collect address label from admin,
     - create customer address via `POST /v1/admins/customers/{customer_id}/places` using `{ "label", "place_id", "isDefault?" }`,
     - use created record/place as booking `place_id`.
   - Admin address creation endpoint is also a standalone capability, not fallback-only.
2. Cleaner step:
   - Query `GET /v1/admins/users/autocomplete?q=...`.
   - Render only `cleaners[]` with `allow_admin_selection=true`.
3. Service step:
   - Select service and duration exactly as regular booking flow.
4. Add-ons step:
   - Build `extras` payload from add-on selections.
5. Final confirmation:
   - Submit `POST /v1/admins/concierge-bookings/create-booking`.
   - Handle `422` with code `CLEANER_NOT_AVAILABLE_FOR_ADMIN_SELECTION` by forcing cleaner re-selection.

## 5.13 Claim Reviews

Base path: `/v1/admins/claim-reviews`

Purpose:

- Tracks complaint/dispute claims and final adjudication results.

Endpoints:

- `GET /`
- `GET /{id}`
- `POST /`
- `PATCH /{id}`
- `POST /{id}/decision`
- `DELETE /{id}`

Schema fields:

- `booking_id`, `customer_id`, `cleaner_id`, `claim_type`, `description`, `evidence_urls`, `decision`, `decision_note`, `decided_by_admin_id`

Frontend notes:

- Build queue/detail/decision views around this module.
- Use `POST /{id}/decision` as explicit adjudication action endpoint.

## 6) Built-In Permission Groups (Current Behavior)

From service behavior:

- `admin`: includes all default admin route permission keys from router discovery.
- `super_admin`: same key set as `admin`, plus runtime bypass behavior for static/env super-admin identity.

Important frontend note:

- Super admin capability is not only a permission-list issue. Some actions are additionally identity-gated (example: `DELETE /v1/admins/{admin_id}`).

## 7) Specialized Permission Groups (Implemented Built-In Set)

These groups are implemented as built-in groups in backend permission-group responses.

## 7.1 Concierge Operations

Group name: `concierge_operator`

Permissions:

- `GET:/admins/concierge-bookings`
- `GET:/admins/concierge-bookings/{id}`
- `POST:/admins/concierge-bookings`
- `POST:/admins/concierge-bookings/create-booking`
- `PATCH:/admins/concierge-bookings/{id}`
- `GET:/admins/users/autocomplete`
- `GET:/admins/customers/{customer_id}/places`
- `POST:/admins/customers/{customer_id}/places`

## 7.2 Promo Handling

Group name: `promo_handler`

Permissions:

- `GET:/admins/promo-codes`
- `GET:/admins/promo-codes/{id}`
- `POST:/admins/promo-codes`
- `PATCH:/admins/promo-codes/{id}`
- `DELETE:/admins/promo-codes/{id}`

## 7.3 Pricing Manager

Group name: `pricing_manager`

Permissions:

- `GET:/admins/pricing-rules`
- `GET:/admins/pricing-rules/{id}`
- `POST:/admins/pricing-rules`
- `PATCH:/admins/pricing-rules/{id}`
- `DELETE:/admins/pricing-rules/{id}`
- `GET:/admins/service-definitions`
- `GET:/admins/service-definitions/{id}`
- `PATCH:/admins/service-definitions/{id}`

## 7.4 Service Catalog Manager

Group name: `service_catalog_manager`

Permissions:

- `GET:/admins/service-definitions`
- `GET:/admins/service-definitions/{id}`
- `POST:/admins/service-definitions`
- `PATCH:/admins/service-definitions/{id}`
- `DELETE:/admins/service-definitions/{id}`
- `GET:/admins/add-ons`
- `GET:/admins/add-ons/{id}`
- `POST:/admins/add-ons`
- `PATCH:/admins/add-ons/{id}`
- `DELETE:/admins/add-ons/{id}`

## 7.5 Service Area Manager

Group name: `service_area_manager`

Permissions:

- `GET:/admins/service-areas`
- `GET:/admins/service-areas/{id}`
- `POST:/admins/service-areas`
- `PATCH:/admins/service-areas/{id}`
- `DELETE:/admins/service-areas/{id}`

## 7.6 Onboarding Reviewer

Group name: `onboarding_reviewer`

Permissions:

- `GET:/admins/cleaners`
- `GET:/admins/cleaners/{cleaner_id}`
- `GET:/admins/onboarding/queue`
- `PATCH:/admins/cleaners/{cleaner_id}/onboarding-review`
- `GET:/admins/cleaner-tags`
- `PATCH:/admins/cleaner-tags/{id}`

## 7.7 Customer Support Desk

Group name: `customer_support_desk`

Permissions:

- `GET:/admins/customers`
- `GET:/admins/customers/{customer_id}`
- `GET:/admins/customers/{customer_id}/places`
- `POST:/admins/customers/{customer_id}/places`
- `GET:/admins/cleaners`
- `GET:/admins/cleaners/{cleaner_id}`
- `GET:/admins/users/autocomplete`
- `GET:/admins/chat-interventions`
- `POST:/admins/chat-interventions`
- `PATCH:/admins/chat-interventions/{id}`

## 7.8 Claims Reviewer

Group name: `claims_reviewer`

Permissions:

- `GET:/admins/claim-reviews`
- `GET:/admins/claim-reviews/{id}`
- `POST:/admins/claim-reviews`
- `PATCH:/admins/claim-reviews/{id}`
- `POST:/admins/claim-reviews/{id}/decision`

## 7.9 Credits and Adjustments

Group name: `credits_adjustments_manager`

Permissions:

- `GET:/admins/service-credits`
- `GET:/admins/service-credits/{id}`
- `POST:/admins/service-credits`
- `POST:/admins/service-credits/grant`
- `PATCH:/admins/service-credits/{id}`
- `GET:/admins/service-credits/balance/{customer_id}`
- `GET:/admins/payout-adjustments`
- `POST:/admins/payout-adjustments`
- `PATCH:/admins/payout-adjustments/{id}`

## 7.10 Broadcast Manager

Group name: `broadcast_manager`

Permissions:

- `GET:/admins/broadcasts`
- `GET:/admins/broadcasts/{id}`
- `POST:/admins/broadcasts`
- `PATCH:/admins/broadcasts/{id}`
- `POST:/admins/broadcasts/dispatch`

## 7.11 Monitoring Analyst

Group name: `monitoring_analyst`

Permissions:

- `GET:/admins/monitoring/overview`
- `GET:/admins/monitoring/auth/heatmap`
- `GET:/admins/monitoring/permissions/denied-top`
- `GET:/admins/monitoring/sessions/anomalies`
- `GET:/admins/monitoring/alerts`
- `GET:/admins/monitoring/alerts/sla`
- `PATCH:/admins/monitoring/alerts/{alert_id}/read`
- `PATCH:/admins/monitoring/alerts/{alert_id}/ack`

## 7.12 Audit and Compliance

Group name: `audit_compliance_reviewer`

Permissions:

- `GET:/admins/monitoring/audit/history`
- `GET:/admins/monitoring/audit/history/{event_id}`
- `POST:/admins/monitoring/audit/export`
- `GET:/admins/monitoring/audit/export/{export_id}`
- `GET:/admins/monitoring/audit/export/{export_id}/download`

## 7.13 Reports Viewer

Group name: `reports_viewer`

Permissions:

- `GET:/admins/reports/users/summary`
- `GET:/admins/reports/users/signups-trend`

## 7.14 Access Governance Reviewer

Group name: `access_reviewer`

Permissions:

- `GET:/admins/permissions/catalog`
- `GET:/admins/access/requests`
- `PATCH:/admins/access/requests/{request_id}/decision`
- `GET:/admins/access/permission-groups`
- `POST:/admins/access/permission-groups`

## 8) Frontend Integration Recommendations

- Build nav and feature flags from `GET /v1/admins/permissions/catalog` plus current admin `permissionList`.
- Do not hardcode super admin by permissions only; respect identity-only guard actions.
- For elevation UX:
  - fetch groups from `GET /access/permission-groups`,
  - allow selecting both raw keys and groups,
  - show resulting merged key set before submit.
- For reviewer UX:
  - use `GET /access/requests` queue,
  - allow partial approval by submitting curated `grantedPermissions`,
  - show audit details (`reviewedBy`, `reviewedAt`, `decisionNote`).

## 9) Error Handling Notes For Frontend

- Validation errors typically return `422`.
- Domain conflicts (duplicate group, already-reviewed request) return `409`.
- Permission denied returns `403` with app error code mapping.
- Main super-admin delete guard returns `403` with detail payload containing:
  - `code: "ADMIN_DELETE_FORBIDDEN"`
  - human-readable `message`
  - `details` object.
