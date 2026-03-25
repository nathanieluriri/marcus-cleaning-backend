# Customer App Frontend API Contract (Current Runtime)

Audience: frontend engineers integrating the customer app against this backend.

Goal: provide an implementation-accurate contract for customer-facing APIs that exist today, including auth, home, booking, notifications, profile, addresses, and settings/session/account actions.

## 1) Scope and Source of Truth

This document reflects currently mounted routes in:

- `api/v1/customer_route.py`
- `services/customer_app_contract_service.py`
- `schemas/customer_app_contract.py`
- `schemas/saved_address.py`

Runtime mount points:

- `/v1/customers/*` (customer account/auth/profile/saved addresses)
- `/v1/*` (customer app contract routes: home/bookings/notifications/settings)

## 2) Global Conventions

### 2.1 Authentication

Protected routes require:

- `Authorization: Bearer <accessToken>`

Public routes include sign-in/up/password-reset and OAuth redirect endpoints.

### 2.2 Success Envelope

Most successful responses are wrapped as:

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

Exception:

- `DELETE /v1/notifications/{notification_id}` returns `204 No Content` with empty body.

### 2.3 Error Envelope

Errors are returned as:

```json
{
  "success": false,
  "message": "...",
  "data": {
    "code": "...",
    "details": {}
  }
}
```

Validation errors return `422` with `message: "Validation error"` and structured field details.

### 2.4 Date/Time Format

Contract timestamps are ISO-8601 UTC datetimes (Pydantic datetime serialization).

## 3) Endpoint Summary (Current)

### 3.1 Auth and Customer Account (`/v1/customers`)

- `POST /v1/customers/sign-in`
  - Request: `{ email, password }`
  - Response data: `{ accessToken, refreshToken|null, expiresAt, user }`
- `POST /v1/customers/sign-up`
  - Request: `{ fullName, email, password }`
  - Response data: same shape as sign-in
  - Status: `201`
- `POST /v1/customers/password-reset/request`
  - Request: `{ email }`
  - Response data: `{ accepted: true }`

Legacy routes still coexist:

- `POST /v1/customers/login`
- `POST /v1/customers/signup`
- `POST /v1/customers/refresh`

OAuth routes:

- `GET /v1/customers/google/auth`
- `GET /v1/customers/auth/callback`

### 3.2 Profile and Saved Addresses (`/v1/customers`)

- `GET /v1/customers/me`
  - Returns authenticated customer profile (legacy customer schema shape)
- `PATCH /v1/customers/me`
  - Request (partial):
    - `fullName?: string`
    - `phoneNumber?: string | null` (must be E.164 when non-null)
    - `avatarDocumentId?: string | null`
  - Response data:
    - `{ id, fullName, email, phoneNumber, avatarDocumentId, avatarUrl, createdAt }`

Saved addresses:

- `GET /v1/customers/me/addresses?start=0&stop=20`
- `POST /v1/customers/me/addresses`
  - Request: `{ label, place_id, isDefault? }`
  - Status: `201`
- `PATCH /v1/customers/me/addresses/{address_id}`
  - Request (partial): `{ label?, place_id? }`
- `DELETE /v1/customers/me/addresses/{address_id}`
- `POST /v1/customers/me/addresses/{address_id}/set-default`

Profile alias namespace (same backend behaviors under customer-app paths):

- `GET /v1/profile/me`
- `PATCH /v1/profile/me`
- `GET /v1/profile/addresses`
- `POST /v1/profile/addresses`
- `PATCH /v1/profile/addresses/{address_id}`
- `DELETE /v1/profile/addresses/{address_id}`
- `GET /v1/profile/payment-methods`
- `POST /v1/profile/payment-methods`
- `PATCH /v1/profile/payment-methods/{payment_method_id}`
- `DELETE /v1/profile/payment-methods/{payment_method_id}`

Address object fields returned by service layer include:

- `id`
- `user_id`
- `label`
- `place` (resolved PlaceOut object)
- `isDefault`
- `dateCreated`
- `lastUpdated`

### 3.3 Home (`/v1`)

- `GET /v1/home`
  - Response data shape matches `HomePayloadContract`:
    - `screen`
    - `user`
    - `header`
    - `location`
    - `sections`
    - `nav`

Current runtime behavior:

- `sections` and `nav.items` are currently returned as empty arrays.
- `location` is built from saved addresses when available.

### 3.4 Booking Contract Endpoints (`/v1`)

- `GET /v1/bookings/services/{service_id}/extras`
  - Returns `BookingExtraContract[]`
  - Runtime currently serves computed/mock-like extras by `service_id` pattern.
- `GET /v1/bookings/cleaners?minRating=&maxHourlyRate=&onlyAvailableNow=`
  - Returns `CleanerCardContract[]`
- `GET /v1/bookings/cleaners/{cleaner_id}`
  - Returns `CleanerProfileContract`
- `GET /v1/bookings/cleaners/{cleaner_id}/reviews?cursor=&pageSize=&stars=&timePeriod=`
  - Returns `{ items, nextCursor }`
- `POST /v1/bookings/create`
  - Request: `BookingCreateRequestContract`
  - Response data: `{ bookingId: string }`
- `POST /v1/bookings/{booking_id}/payments/mark-paid`
  - Idempotent customer action that marks booking payment paid
- `PATCH /v1/bookings/{booking_id}/payments/mark-paid`
  - Patch alias of the same mark-paid action
- `POST /v1/bookings/{booking_id}/ratings`
  - Request: `{ rating, comment }`
  - Response data: `{ id, isRated, customerRating, customerComment, updatedAt }`

### 3.5 Notifications (`/v1`)

- `GET /v1/notifications?page=0&pageSize=20`
  - Returns `NotificationItemContract[]`
- `POST /v1/notifications/{notification_id}/read`
  - Response data: `{ updated: true }`
- `POST /v1/notifications/read-all`
  - Response data: `{ updated: true }`
- `DELETE /v1/notifications/{notification_id}`
  - Status: `204`

### 3.6 Settings, Sessions, and Account Lifecycle (`/v1`)

- `GET /v1/settings`
  - Returns `SettingsSnapshotContract`:
    - `notifications`
    - `privacy` (object)
    - `security`
    - `sessions`
    - `accountLifecycle`
    - `legal` (object)
- `PATCH /v1/settings/notifications`
  - Request: partial `NotificationPreferencesPatchContract`
  - Response: `NotificationPreferencesContract`
- `PATCH /v1/settings/security`
  - Request: partial `SecurityPreferencesPatchContract`
  - Response: `SecurityPreferencesContract`
- `PATCH /v1/settings/privacy`
  - Request: partial `PrivacyPreferencesPatchContract`
  - Response: merged privacy object
- `POST /v1/settings/sessions/revoke-others`
  - Response data: `{ revokedAccessSessions, revokedRefreshSessions }`
- `POST /v1/settings/sessions/revoke-all`
  - Response data: `{ revokedAccessSessions, revokedRefreshSessions }`
- `POST /v1/settings/sessions/logout`
  - Response data: `{ revokedAccessSessions, revokedRefreshSessions }`
- `DELETE /v1/settings/security/sessions/{session_id}`
  - Revokes one non-current session
- `POST /v1/settings/account/deactivate`
  - Request: `{ effectiveAt?: datetime }`
  - Response data: `{ accepted, scheduled, action: "deactivate", effectiveAt }`
- `POST /v1/settings/account/delete`
  - Request: `{ confirmationText, effectiveAt?: datetime }`
  - `confirmationText` must equal `DELETE`
  - Response data: `{ accepted, scheduled, action: "delete", effectiveAt }`
- `DELETE /v1/settings/account`
  - Alias of account deletion request

## 4) Contract Enums (Current)

From `schemas/customer_app_contract.py`:

- `AppActionType`: `route | deeplink | bottom_sheet | modal | external_url`
- `NotificationTypeContract`: `booking_confirmed | cleaner_arriving | special_offer | rating_request | service_update | payment_receipt | reminder`
- `ReviewTimePeriodContract`: `all | last30Days | last90Days | lastYear`
- `BookingDurationTypeContract`: `preset | custom`
- `BookingDraftStatusContract`: `draft | pendingConfirmation | confirmed`

## 5) Remaining Gaps vs Expected Customer Spec

The major path-level gaps are now implemented as aliases. Remaining differences are mainly payload/enum shape mismatches:

- Booking history/detail currently returns booking-domain `BookingOut` records, not the fully transformed `BookingRequest` shape (`serviceTitle`, `isRated`, etc.).
- Profile payment-method APIs use current payment-method contracts (`provider_method_ref`, `type`, `is_default`) rather than the expected app-facing fields (`paymentMethodToken`, `setAsDefault`, etc.).
- Settings privacy/session/account now support the expected paths, but response payloads follow current backend model contracts.

## 6) Frontend Integration Notes

- Use `/v1/customers/sign-in` and `/v1/customers/sign-up` as preferred auth endpoints for contract-aligned payloads.
- Treat `/v1/bookings/create` as the booking creation endpoint (not `/v1/booking`).
- Handle both `200` enveloped success and `204` empty success (`DELETE /notifications/{id}`).
- For settings/account flows, use POST-based lifecycle endpoints currently implemented (`/settings/account/deactivate`, `/settings/account/delete`).
