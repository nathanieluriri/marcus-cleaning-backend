# Admin Concierge Booking Frontend Flow

Audience: frontend engineers implementing the admin concierge booking modal/flow.

Goal: create a booking on behalf of a customer using the same booking contract as regular booking, enforce cleaner eligibility (`allow_admin_selection=true`), and support admin-managed customer address creation.

## 1) Endpoint Summary

Primary submit endpoint:

- `POST /v1/admins/concierge-bookings/create-booking`

Supporting picker/config endpoints:

- `GET /v1/admins/users/autocomplete?q={text}&limit={n}`
- `GET /v1/admins/customers/{customer_id}/places`
- `POST /v1/admins/customers/{customer_id}/places`
- `GET /v1/admins/service-definitions`
- `GET /v1/admins/add-ons`
- `GET /v1/admins/cleaners` (optional fallback directory view)
- `GET /v1/admins/cleaners/{cleaner_id}` (optional detail view)

All above endpoints are admin-protected and require valid admin token + route permission.

## 2) Required Permissions

Minimum recommended keys for concierge creator UI:

- `GET:/admins/users/autocomplete`
- `GET:/admins/customers/{customer_id}/places`
- `POST:/admins/customers/{customer_id}/places`
- `GET:/admins/service-definitions`
- `GET:/admins/add-ons`
- `POST:/admins/concierge-bookings/create-booking`
- Optional read operations:
  - `GET:/admins/cleaners`
  - `GET:/admins/cleaners/{cleaner_id}`

Built-in group coverage:

- `concierge_operator` includes the core concierge keys.

## 3) Canonical Request Contract (Submit)

`POST /v1/admins/concierge-bookings/create-booking`

Request body must match booking schema:

```json
{
  "customer_id": "customer_object_id",
  "place_id": "place_id_or_saved_place_reference",
  "cleaner_id": "cleaner_object_id",
  "schedule": 1775000000,
  "extras": { "add_ons": [] },
  "service": "STANDARD",
  "duration": { "hours": 2, "minutes": 0 },
  "custom_details": null
}
```

Server behavior:

- Uses authenticated admin token identity (does not trust caller self-id from request body).
- Re-validates customer and cleaner existence.
- Rejects cleaner when `allow_admin_selection != true`.
- Runs the regular booking pipeline (payment + quote attachment).
- Creates linked concierge tracking record.

Success response (`201`):

```json
{
  "success": true,
  "message": "Concierge booking created successfully",
  "data": {
    "booking": { "id": "booking_id", "...": "..." },
    "concierge_record": { "id": "concierge_record_id", "...": "..." }
  }
}
```

## 4) Mandatory Frontend Modal Steps

Implement as a strict multi-step modal:

1. Customer Step
- Search with `GET /v1/admins/users/autocomplete?q={text}&limit=10`
- Render and allow selection only from `data.customers[]`
- Persist selected `customer_id`
- After selecting customer, load known addresses with `GET /v1/admins/customers/{customer_id}/places`
- If places are returned, allow admin to select one and prefill `place_id`
- Manual fallback should be shown only when places are unavailable (`[]`, endpoint error, or permission denial)
- In fallback mode, use this exact sequence:
  1. Call places autocomplete (`GET /v1/places/autocomplete`) with typed location input.
  2. User selects a location suggestion.
  3. Resolve details if needed (`GET /v1/places/details?place_id=...`) and keep selected `place_id`.
  4. Ask admin for address label (example: `Home`, `Office`, `Client HQ`).
  5. Save new customer address using `POST /v1/admins/customers/{customer_id}/places` with `{ "label", "place_id", "isDefault?" }`.
  6. Use saved response place to set concierge booking `place_id` and continue flow.
- Admin address creation is also a standalone capability (not fallback-only): admins can proactively create a new address for the selected customer even when addresses already exist.
  - For standalone address creation, use the same endpoint/body contract; actor admin attribution is token-derived server-side.

2. Cleaner Step
- Search with `GET /v1/admins/users/autocomplete?q={text}&limit=10`
- Render candidates from `data.cleaners[]`
- Only selectable cleaners:
  - `allow_admin_selection === true`
- Recommended UI:
  - disable rows where `allow_admin_selection` is false
  - show helper text: “Not available for admin assignment”
- Persist selected `cleaner_id`

3. Service Step
- Load service options from `GET /v1/admins/service-definitions`
- Select `service` and `duration`
- If `service == CUSTOM`, enforce `custom_details` UI
- If `service != CUSTOM`, ensure `custom_details = null`

4. Add-ons Step
- Load from `GET /v1/admins/add-ons`
- Build `extras` in booking-compatible shape
- Keep this contract identical to regular booking flow to avoid backend validation mismatch

5. Schedule + Confirm Step
- Validate schedule at least 1 hour in the future (client-side precheck)
- Build final payload (booking fields only)
- Submit once to `POST /v1/admins/concierge-bookings/create-booking`

## 5) Frontend Validation Rules (Before Submit)

- `customer_id` selected
- `cleaner_id` selected
- selected cleaner has `allow_admin_selection === true`
- `place_id` present
- valid `service`
- valid `duration`
- `schedule` is a unix timestamp at least +1 hour from now
- `custom_details` required only when `service == CUSTOM`

## 6) Error Handling Contract

Important business error:

- HTTP `422`
- Code: `CLEANER_NOT_AVAILABLE_FOR_ADMIN_SELECTION`
- Meaning: selected cleaner is not eligible for admin assignment
- Frontend action:
  - keep customer and service selections
  - force return to cleaner step
  - show explicit banner/toast and ask user to re-select cleaner

Standard response envelope errors may also include:

- `401` unauthorized token/session
- `403` permission denied
- `404` resource not found (customer/cleaner)
- `422` booking validation issues (schedule, custom-details contract)

## 7) System-Owned Status + State Machine Rules

- Booking status and concierge tracking status are system-owned.
- Clients should never send or patch status values for concierge lifecycle control.
- Generic concierge CRUD should be treated as metadata-only for manual writes; lifecycle state transitions come from backend state machine events.
- Expected lifecycle order:
  - `REQUESTED -> ACCEPTED -> CLEANER_COMPLETED -> CUSTOMER_ACKNOWLEDGED`
  - `CANCELLED` is terminal when triggered by allowed backend transition.

## 8) Recommended State Shape (Frontend)

```ts
type ConciergeDraft = {
  adminId: string;
  customerId: string | null;
  cleanerId: string | null;
  placeId: string | null;
  schedule: number | null;
  service: string | null;
  duration: { hours: number; minutes: number } | null;
  extras: Record<string, unknown>;
  customDetails: Record<string, unknown> | null;
};
```

Keep draft state across steps; only call submit endpoint at final confirmation.

## 9) Integration Notes

- This concierge submit contract is intentionally aligned with regular booking contract to reduce drift.
- Do not transform field names on submit; send backend schema keys exactly.
- Treat backend quote/payment result as source of truth for final displayed price after creation.
