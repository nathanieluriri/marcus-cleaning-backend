# 03 — Config / Wiring Notes (not endpoint gaps, but will block "going dynamic")

These aren't missing endpoints — they're client-side wiring issues that will stop the apps from
reaching the backend even once the endpoints exist. Listed here so nothing is a surprise.

## 1. The `/api` prefix vs Dio base-URL resolution ⚠️

- Backend routes are all under `/api/v1/...`.
- The apps call paths like `/v1/customers/sign-in` (leading slash, **no** `/api`).
- Given base URL `https://marcus-cleaning-backend.vercel.app/api/`, Dio resolves a request path
  that **starts with `/`** against the **origin**, dropping the base path — i.e. `/v1/...` becomes
  `https://…/v1/...` and the `/api` segment is **lost** → 404.

**Fix (app side), pick one:**
- Set base URL to the origin `https://marcus-cleaning-backend.vercel.app` and change all data-source
  paths to `/api/v1/...`, **or**
- Keep base `.../api/` and make data-source paths **relative without a leading slash**
  (`v1/customers/login`) so Dio appends them to the base path.

The refresh call in [api_client.dart](../apps/customer_app/lib/app/network/api_client.dart)
(`/v1/customers/refresh`, and the 401 guard comparing `request.path == '/v1/customers/refresh'`)
must be updated to whatever final path is chosen, or token refresh will silently break.

## 2. Customer app env — `API_BASE_URL` required

[customer_app/lib/app/config/runtime_config.dart](../apps/customer_app/lib/app/config/runtime_config.dart)
throws if `API_BASE_URL` is missing from `apps/customer_app/.env`. Set:
```
API_BASE_URL=https://marcus-cleaning-backend.vercel.app/api/   # (or origin — see note 1)
```

## 3. Cleaner app — still on mocks + placeholder base URL

- [cleaner_app/lib/app/config/runtime_config.dart](../apps/cleaner_app/lib/app/config/runtime_config.dart)
  defaults `CLEANER_API_BASE_URL` to `https://api.example.com` and `CLEANER_USE_MOCK_API` to `true`.
- Only **jobs** and **profile** have HTTP data sources; cleaner **auth/onboarding/availability/
  support/settings/verification** are mock-only and not yet wired to the backend (the backend
  *does* have `/api/v1/cleaners/login|signup|onboarding|refresh`).
- To go live: set `CLEANER_API_BASE_URL`, pass `--dart-define=CLEANER_USE_MOCK_API=false`, and wire
  the remaining cleaner features to real data sources.

## 4. Response envelope — already aligned ✅

The backend's `{ success, message, data, requestId }` envelope matches the customer app's
`ApiClient._unwrapResponse` (it unwraps `data` and treats `success:false` as an error). No change
needed there — only the *contents* of `data` differ (see [02](02-contract-mismatches.md)). The
cleaner app's data sources unwrap `data` manually too, so they're compatible.
