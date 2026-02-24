# Admin Permission Catalog API Guide

This guide explains how to fetch assignable permission keys and use them to set role permission templates.

## Purpose

Admins can discover all assignable non-admin API permissions from one endpoint, then submit a selected list to:

1. update a role template (`cleaner` or `customer`)
2. roll out that template to existing users

## Endpoint: Fetch Permission Catalog

- **Method:** `GET`
- **URL:** `/v1/admins/permissions/catalog`
- **Auth:** Admin access token required (`Authorization: Bearer <token>`)

### Example Request

```bash
curl -X GET "http://localhost:8000/v1/admins/permissions/catalog" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>"
```

### Example Response (trimmed)

```json
{
  "success": true,
  "message": "Permission catalog fetched successfully",
  "data": {
    "grouped": [
      {
        "resource": "customers",
        "routes": [
          {
            "resource": "customers",
            "method": "GET",
            "path": "/v1/customers/me",
            "normalized_path": "/customers/me",
            "key": "GET:/customers/me",
            "endpoint_name": "get_my_users",
            "summary": null,
            "description": null,
            "requires_auth": true
          }
        ]
      }
    ],
    "flat": {
      "permissions": [
        {
          "name": "get_my_users",
          "methods": ["GET"],
          "path": "/customers/me",
          "key": "GET:/customers/me",
          "description": null
        }
      ]
    }
  },
  "requestId": "..."
}
```

## How to Use in a Frontend

### 1) Load catalog

Call `GET /v1/admins/permissions/catalog` after admin login.

Use:
- `data.grouped` to render sections/tables by resource (`customers`, `cleaners`, `payments`, `documents`)
- `data.flat.permissions` when building a direct payload for template updates

### 2) Let admin select permissions

Store selected entries by `key` (recommended unique identifier).

### 3) Build template update payload

Send selected permissions as `permissionList.permissions`.

```json
{
  "permissionList": {
    "permissions": [
      {
        "name": "get_my_users",
        "methods": ["GET"],
        "path": "/customers/me",
        "key": "GET:/customers/me",
        "description": "Read customer profile"
      }
    ]
  }
}
```

### 4) Update role template

- **Method:** `PUT`
- **URL:** `/v1/admins/permission-templates/{role}`
- **Role values:** `cleaner` or `customer`

```bash
curl -X PUT "http://localhost:8000/v1/admins/permission-templates/customer" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "permissionList": {
      "permissions": [
        {
          "name": "get_my_users",
          "methods": ["GET"],
          "path": "/customers/me",
          "key": "GET:/customers/me",
          "description": "Read customer profile"
        }
      ]
    }
  }'
```

### 5) Roll out to existing users

- **Method:** `POST`
- **URL:** `/v1/admins/permission-templates/{role}/rollout`

```bash
curl -X POST "http://localhost:8000/v1/admins/permission-templates/customer/rollout" \
  -H "Authorization: Bearer <ADMIN_ACCESS_TOKEN>"
```

## Notes

- The catalog intentionally excludes `/v1/admins/*` routes.
- `key` is the canonical permission identifier; keep it unchanged.
- `normalized_path` and `flat.permissions[*].path` are returned without `/v1` to match runtime permission checks.
