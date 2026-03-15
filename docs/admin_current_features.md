# Admin Current Features

This document lists the features currently available to admins in the backend today.

## One-Sentence Feature List

1. Admins can view a paginated list of admin accounts.
2. Admins can fetch their own authenticated admin profile.
3. Admins can view the effective permission template for `customer` and `cleaner` roles.
4. Admins can update permission templates for `customer` and `cleaner` roles.
5. Admins can roll out a role permission template to existing users of that role.
6. Admins can fetch a live permission catalog of assignable non-admin API routes.
7. Admins can review cleaner onboarding requests by approving or rejecting them.
8. Admins can create another admin account (admin-invited signup flow).
9. Admins can authenticate with email/password and receive access and refresh tokens.
10. Admins can refresh admin tokens using a refresh token plus expired access-token context.
11. Admins can delete their own admin account and invalidate all related tokens.

## Detailed Feature Breakdown

### 1) View Admin List
- Endpoint: `GET /v1/admins/`
- Auth/guard: `check_admin_account_status_and_permissions`
- Query params: `start` (offset, `>=0`), `stop` (limit boundary, `>0`)
- Behavior: returns a paginated list of admin records from `retrieve_admins(start, stop)`.
- Response envelope message: `Admins fetched successfully`.

### 2) Fetch Authenticated Admin Profile
- Endpoint: `GET /v1/admins/profile`
- Auth/guard: `check_admin_account_status_and_permissions`
- Behavior: returns the authenticated admin object injected by the guard/dependency.
- Response envelope message: `Admin profile fetched successfully`.

### 3) View Role Permission Template
- Endpoint: `GET /v1/admins/permission-templates/{role}`
- Auth/guard: `check_admin_account_status_and_permissions`
- Path param: `role` is limited to `cleaner` or `customer`.
- Behavior: returns effective role template via `get_role_permission_template_view(role)`; source can be explicit template or default role permissions.
- Response envelope message: `Role permission template fetched successfully`.

### 4) Update Role Permission Template
- Endpoint: `PUT /v1/admins/permission-templates/{role}`
- Auth/guard: `check_admin_account_status_and_permissions`
- Path param: `role` is limited to `cleaner` or `customer`.
- Request body: `RolePermissionTemplateUpdate` (`permissionList.permissions[...]`).
- Behavior: upserts the role template and records the updating admin id.
- Response envelope message: `Role permission template updated successfully`.

### 5) Roll Out Role Permission Template
- Endpoint: `POST /v1/admins/permission-templates/{role}/rollout`
- Auth/guard: `check_admin_account_status_and_permissions`
- Path param: `role` is limited to `cleaner` or `customer`.
- Behavior: applies current role template (or default role permissions if no template exists) to existing users of the selected role and returns matched/modified counts.
- Response envelope message: `Role permission rollout completed successfully`.

### 6) Fetch Assignable Permission Catalog
- Endpoint: `GET /v1/admins/permissions/catalog`
- Auth/guard: `check_admin_account_status_and_permissions`
- Behavior: builds route-based permission catalog from app routes via `build_permission_catalog_from_routes(...)`, grouped and flat.
- Important rule: catalog intentionally excludes `/v1/admins/*` routes; it is for assignable non-admin permissions.
- Response envelope message: `Permission catalog fetched successfully`.

### 7) Review Cleaner Onboarding
- Endpoint: `PATCH /v1/admins/cleaners/{cleaner_id}/onboarding-review`
- Auth/guard: `check_admin_account_status_and_permissions`
- Request body: `CleanerOnboardingReviewRequest` (status/rejection reason semantics).
- Behavior: admin can approve/reject cleaner onboarding via `review_cleaner_onboarding`; approval validates required profile completeness before allowing approval.
- Response envelope message: `Cleaner onboarding review updated successfully`.

### 8) Create Another Admin (Admin-Invited)
- Endpoint: `POST /v1/admins/signup`
- Auth/guard: `check_admin_account_status_and_permissions`
- Request body: `AdminBase` (converted to `AdminCreate` with `invited_by=authenticated_admin.id`).
- Behavior: creates new admin if email is unused, then issues admin access/refresh tokens for the created account.
- Response envelope message/status: `Admin created successfully` (`201`).

### 9) Admin Login
- Endpoint: `POST /v1/admins/login`
- Auth/guard: none (public login endpoint).
- Request body: `AdminLogin`.
- Behavior: validates credentials, then issues access/refresh tokens.
- Response envelope message: `Admin login successful`.

### 10) Admin Token Refresh
- Endpoint: `POST /v1/admins/refresh`
- Auth/guard: `verify_admin_refresh_token` (expired access token context allowed for refresh flow).
- Request body: `AdminRefresh` (`refresh_token`).
- Behavior: validates refresh token against prior access token linkage (`previousAccessToken == expired_access_token`), issues new tokens, and invalidates old access/refresh tokens on success.
- Response envelope message: `Admin tokens refreshed successfully`.

### 11) Delete Admin Account
- Endpoint: `DELETE /v1/admins/account`
- Auth/guard: `check_admin_account_status_and_permissions`
- Behavior: deletes the admin record via `remove_admin(admin_id)` and deletes all tokens tied to that admin id.
- Response envelope message: `Admin account deleted successfully`.

## Notes
- Admin route prefix is `/v1/admins`.
- Most admin endpoints are protected by the admin account-status/permission guard, which enforces active account status and permission checks.
- This document reflects currently implemented backend behavior, not backlog/planned features.
