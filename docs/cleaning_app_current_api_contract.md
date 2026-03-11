# Cleaning App Current API Contracts (Backend-Style, Implemented)

This document defines the **implemented backend-style API surface** for customer app integration in this repo.

## Response Envelope

All documented endpoints (except `204` deletes) return the standard backend envelope:

```json
{
  "success": true,
  "message": "string",
  "data": {}
}
```

Error responses follow the backend error envelope:

```json
{
  "success": false,
  "message": "Human-readable message",
  "data": {
    "code": "string_machine_code",
    "details": {}
  }
}
```

## Auth Contract

### Sign In
- Method: `POST`
- Path: `/v1/customers/sign-in`
- Request:
```json
{
  "email": "user@example.com",
  "password": "string"
}
```
- Response `200` (`data`):
```json
{
  "accessToken": "string",
  "refreshToken": "string|null",
  "expiresAt": "2026-03-01T12:00:00.000Z",
  "user": {
    "id": "string",
    "fullName": "string",
    "email": "string",
    "phoneNumber": null,
    "createdAt": "2026-03-01T12:00:00.000Z"
  }
}
```

### Sign Up
- Method: `POST`
- Path: `/v1/customers/sign-up`
- Request:
```json
{
  "fullName": "string",
  "email": "user@example.com",
  "password": "string"
}
```
- Response `201`: same data shape as Sign In.

### Request Password Reset
- Method: `POST`
- Path: `/v1/customers/password-reset/request`
- Request:
```json
{
  "email": "user@example.com"
}
```
- Response `200` (`data`):
```json
{
  "accepted": true
}
```

## Home Contract

### Fetch Home Summary
- Method: `GET`
- Path: `/v1/cleaners/home`
- Auth: customer bearer token
- Response `200` (`data`): home payload contract (`screen`, `user`, `header`, `location`, `sections`, `nav`).

## Booking Contract

### Fetch Extras by Service
- Method: `GET`
- Path: `/v1/bookings/services/{serviceId}/extras`
- Response `200` (`data`):
```json
[
  {
    "id": "extra_laundry",
    "title": "Laundry",
    "price": 20.0,
    "isAvailable": true
  }
]
```

### Fetch Available Cleaners
- Method: `GET`
- Path: `/v1/bookings/cleaners`
- Query params: `minRating`, `maxHourlyRate`, `onlyAvailableNow`
- Response `200` (`data`): cleaner card list.

### Fetch Cleaner Profile
- Method: `GET`
- Path: `/v1/bookings/cleaners/{cleanerId}`
- Response `200` (`data`): cleaner profile payload.

### Fetch Cleaner Reviews (Paginated)
- Method: `GET`
- Path: `/v1/bookings/cleaners/{cleanerId}/reviews`
- Query params: `cursor`, `pageSize`, `stars`, `timePeriod`
- Response `200` (`data`):
```json
{
  "items": [],
  "nextCursor": "10"
}
```

### Create Booking
- Method: `POST`
- Path: `/v1/bookings/create`
- Request body: booking context contract payload.
- Response `200` (`data`):
```json
{
  "bookingId": "BK-1700000000000"
}
```

## Notifications Contract

### Fetch Notifications
- Method: `GET`
- Path: `/v1/notifications`
- Query params: `page` (default `0`), `pageSize` (default `20`)
- Response `200` (`data`): notification list.

### Mark Notification as Read
- Method: `POST`
- Path: `/v1/notifications/{notificationId}/read`
- Response `200` (`data`):
```json
{
  "updated": true
}
```

### Mark All Notifications as Read
- Method: `POST`
- Path: `/v1/notifications/read-all`
- Response `200` (`data`):
```json
{
  "updated": true
}
```

### Delete Notification
- Method: `DELETE`
- Path: `/v1/notifications/{notificationId}`
- Response `204` empty body.

## Settings Contract

### Fetch Settings Snapshot
- Method: `GET`
- Path: `/v1/settings`
- Response `200` (`data`):
```json
{
  "notifications": {
    "enabled": true,
    "channels": {
      "push": true,
      "email": true,
      "sms": false
    },
    "quietHours": {
      "enabled": false,
      "startTime": "22:00",
      "endTime": "07:00",
      "timezone": "UTC"
    }
  },
  "privacy": {},
  "security": {
    "biometricLoginEnabled": false,
    "twoFactorEnabled": false
  },
  "sessions": {},
  "legal": {}
}
```

### Update Notification Preferences
- Method: `PATCH`
- Path: `/v1/settings/notifications`
- Request body: partial notification preference payload (supports `enabled`, `channels`, `quietHours`).
- Response `200` (`data`): updated `notifications` preference object.

### Update Security Preferences
- Method: `PATCH`
- Path: `/v1/settings/security`
- Request body: partial security preference payload (supports `biometricLoginEnabled`, `twoFactorEnabled`).
- Response `200` (`data`): updated `security` preference object.

## Auth Header Contract

Protected endpoints use:

`Authorization: Bearer <accessToken>`

## Notes

- This contract is implemented in backend style (customer/cleaner/booking/notifications resource grouping).
- Payloads are contract-shaped inside the backend envelope.
- Hybrid data mode is active: live service/db values are used where available, with deterministic fallback values for currently missing contract fields.
