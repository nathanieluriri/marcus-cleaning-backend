# Split User Report

Generated at: 2026-02-22T23:22:54.488093+00:00

## Summary
- Converted to split roles: cleaner, customer
- Archive folder: .fasterapi/archive/20260222T232254Z
- Updated runtime auth/principal/account checks for role-aware verification.
- Applied ROLE_RATE_LIMITS default: `anonymous:20/minute,cleaner:80/minute,customer:80/minute,admin:140/minute`
- Generated files: schemas/cleaner_schema.py, repositories/cleaner_repo.py, services/cleaner_service.py, api/v1/cleaner_route.py, schemas/customer_schema.py, repositories/customer_repo.py, services/customer_service.py, api/v1/customer_route.py
