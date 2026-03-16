from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException, status
from typing import List

from repositories.admin_repo import create_admin, delete_admin, get_admin, get_admins, update_admin
from schemas.admin_schema import AdminBase, AdminCreate, AdminOut, AdminRefresh, AdminUpdate
from security.auth0_client import Auth0APIError, password_login, refresh_access_token, signup_email_password
from security.auth0_verifier import Auth0Claims, get_auth0_token_verifier
from services.auth_identity_service import refresh_account_after_update, resolve_role_account_for_claims


def _map_auth0_error(err: Auth0APIError) -> HTTPException:
    if err.status_code in {400, 401, 403}:
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(err))
    if err.status_code == 409:
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))


async def _claims_from_access_token(access_token: str) -> Auth0Claims:
    try:
        return await get_auth0_token_verifier().verify_access_token(access_token)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Auth0 access token") from err


async def add_admin(admin_data: AdminCreate) -> AdminOut:
    existing = await get_admin({"email": admin_data.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Admin Already exists")

    try:
        await signup_email_password(email=str(admin_data.email), password=str(admin_data.password))
        token_set = await password_login(email=str(admin_data.email), password=str(admin_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    created = await create_admin(
        AdminCreate(
            **admin_data.model_dump(),
            auth_provider="auth0",
            auth_subject=claims.sub,
            email_verified=claims.email_verified,
            last_auth_at=claims.iat,
        )
    )
    created.password = ""
    created.access_token = token_set.access_token
    created.refresh_token = token_set.refresh_token
    return created


async def authenticate_admin(admin_data: AdminBase) -> AdminOut:
    try:
        token_set = await password_login(email=str(admin_data.email), password=str(admin_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

    resolved = await refresh_account_after_update(role="admin", user_id=str(admin.id))  # type: ignore[arg-type]
    resolved.password = ""
    resolved.access_token = token_set.access_token
    resolved.refresh_token = token_set.refresh_token
    return resolved


async def refresh_admin_tokens_reduce_number_of_logins(
    admin_refresh_data: AdminRefresh,
    expired_access_token: str,
):
    _ = expired_access_token
    try:
        token_set = await refresh_access_token(refresh_token=admin_refresh_data.refresh_token)
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

    resolved = await refresh_account_after_update(role="admin", user_id=str(admin.id))  # type: ignore[arg-type]
    resolved.password = ""
    resolved.access_token = token_set.access_token
    resolved.refresh_token = token_set.refresh_token or admin_refresh_data.refresh_token
    return resolved


async def remove_admin(admin_id: str):
    if not ObjectId.is_valid(admin_id):
        raise HTTPException(status_code=400, detail="Invalid admin ID format")

    result = await delete_admin({"_id": ObjectId(admin_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")


async def retrieve_admin_by_admin_id(id: str) -> AdminOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid admin ID format")

    result = await get_admin({"_id": ObjectId(id)})
    if not result:
        raise HTTPException(status_code=404, detail="Admin not found")
    return result


async def retrieve_admins(start=0, stop=100) -> List[AdminOut]:
    return await get_admins(start=start, stop=stop)


async def update_admin_by_id(admin_id: str, admin_data: AdminUpdate, is_password_getting_changed: bool = False) -> AdminOut:
    _ = is_password_getting_changed
    if not ObjectId.is_valid(admin_id):
        raise HTTPException(status_code=400, detail="Invalid admin ID format")

    result = await update_admin({"_id": ObjectId(admin_id)}, admin_data)
    if not result:
        raise HTTPException(status_code=404, detail="Admin not found or update failed")
    return result
