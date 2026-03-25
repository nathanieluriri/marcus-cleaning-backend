# Admin Customer Places Endpoint

This document explains the admin endpoint:

- `GET /v1/admins/customers/{customer_id}/places`
- `POST /v1/admins/customers/{customer_id}/places`

## Purpose

Returns the selected customer's saved locations as `PlaceOut` objects so admin flows (especially concierge booking) can reuse validated customer locations without rebuilding place data manually.

## Route

- `GET /v1/admins/customers/{customer_id}/places`
  - Handler: `get_customer_places_for_admin`
  - Service: `retrieve_admin_customer_places`
- `POST /v1/admins/customers/{customer_id}/places`
  - Handler: `create_customer_place_for_admin`
  - Service: `create_admin_customer_place`

## Authentication and Authorization

This endpoint is protected by admin auth:

- Requires a valid admin access token.
- Requires account status and permission checks through `check_admin_account_status_and_permissions`.

Permission key:

- `GET:/admins/customers/{customer_id}/places`
- `POST:/admins/customers/{customer_id}/places`

Included in:

- `super_admin` (automatic via full admin key set)
- `concierge_operator` (explicitly added)
- `customer_support_desk` (explicitly added)

## Request Contract

Path params:

- `customer_id` (string): target customer id.

Query params:

- `start` (int, default `0`, min `0`)
- `stop` (int, default `20`, min `1`, max `100`)

Example:

```http
GET /v1/admins/customers/67f0f0f0f0f0f0f0f0f0f0f1/places?start=0&stop=20
Authorization: Bearer <admin_token>
```

Create request body (`POST`, admin contract):

```json
{
  "label": "Home",
  "place_id": "ChIJ..."
}
```

Notes:

- Uses customer create request shape (`label`, `place_id`, optional `isDefault`) while preserving admin-only route protection.
- `place_id` is required for create/update write flows.
- Backend resolves `place_id` into full `PlaceOut` using place details/cache logic.
- Admins do not submit raw `PlaceOut` manually.
- Actor attribution (`created_by_admin_id`) is derived from authenticated admin identity, not caller payload.

## Response Contract

Success envelope:

```json
{
  "success": true,
  "message": "Customer places fetched successfully",
  "data": [
    {
      "place_id": "ChIJ...",
      "name": "Home",
      "formatted_address": "Ikeja, Lagos, Nigeria",
      "longitude": 3.349,
      "latitude": 6.601,
      "country_code": "NG",
      "description": "Saved default address"
    }
  ],
  "requestId": "..."
}
```

`data` is a list of `PlaceOut`.

Create success envelope:

```json
{
  "success": true,
  "message": "Customer place created successfully",
  "data": {
    "id": "saved_address_id",
    "user_id": "customer_id",
    "label": "Home",
    "place": {
      "place_id": "ChIJ...",
      "name": "Home",
      "formatted_address": "Ikeja, Lagos, Nigeria",
      "longitude": 3.349,
      "latitude": 6.601,
      "country_code": "NG",
      "description": "Ikeja, Lagos, Nigeria"
    },
    "isDefault": true,
    "created_by_admin_id": "admin_object_id",
    "dateCreated": 1774056000,
    "lastUpdated": 1774056000
  },
  "requestId": "..."
}
```

## Internal Behavior

`retrieve_admin_customer_places(...)` performs:

1. Validates admin identity exists (`admin_id` must be present from authenticated admin).
2. Verifies customer exists by calling admin customer detail retrieval.
3. Loads customer saved addresses from saved-address service.
4. Extracts `place` from each saved address.
5. De-duplicates by `place_id` (last item wins for duplicate ids).
6. Returns a list of unique `PlaceOut` objects.

`create_admin_customer_place(...)` performs:

1. Validates admin identity exists (`admin_id` must be present).
2. Verifies target customer exists.
3. Resolves request `place_id` to `PlaceOut` via place service/cache.
4. Creates a saved address entry for that customer using label + resolved place and stores `created_by_admin_id` from authenticated admin token.

## Error Behavior

Common responses:

- `401`: invalid or missing admin token.
- `403`: permission denied or missing admin identity context.
- `400`: invalid customer id format.
- `404`: customer not found.
- `422`: invalid query parameter constraints.

Error envelope follows standard API error format.

## Frontend Integration Notes

Recommended concierge flow usage:

1. Select customer (usually via `GET /v1/admins/users/autocomplete`).
2. Call this endpoint with selected `customer_id`.
3. Show returned places as location options.
4. On selection, set `place_id` in concierge booking payload.
5. If place list is unavailable (`[]`, fetch error, or permission denial), show manual fallback and create via `POST /v1/admins/customers/{customer_id}/places` using `{ "label", "place_id", "isDefault?" }`.

This create endpoint is also a standalone admin capability, not only fallback behavior.

## Relationship to Concierge Booking

These endpoints support:

- `POST /v1/admins/concierge-bookings/create-booking`

They reduce location-entry friction and ensure location references are aligned with customer-saved places while keeping booking payload schema unchanged (`place_id` is still required in booking payload).
