from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException, status
from typing import List

from repositories.customer_repo import create_user, delete_user, get_user, get_users, update_user
from schemas.customer_schema import (
    CustomerCreate,
    CustomerLogin,
    CustomerOut,
    CustomerRefresh,
    CustomerSignupRequest,
    CustomerUpdate,
)
from schemas.imports import AccountStatus, LoginType
from security.auth0_client import Auth0APIError, password_login, refresh_access_token, signup_email_password
from security.auth0_verifier import Auth0Claims, get_auth0_token_verifier
from services.auth_identity_service import refresh_account_after_update, resolve_role_account_for_claims
from services.role_permission_template_service import get_effective_permission_list_for_role


def _email_name_parts(email: str) -> tuple[str, str]:
    local = (email.split("@", 1)[0] or "user").replace(".", " ").replace("_", " ").strip()
    if not local:
        return "User", ""
    parts = local.split(" ", 1)
    if len(parts) == 1:
        return parts[0].capitalize(), ""
    return parts[0].capitalize(), parts[1].capitalize()


async def _resolve_or_provision_customer(
    *,
    claims: Auth0Claims,
    first_name: str | None = None,
    last_name: str | None = None,
    login_type: LoginType,
    seed_password: str,
) -> CustomerOut:
    account = await resolve_role_account_for_claims(role="customer", claims=claims)
    if account is not None:
        return await refresh_account_after_update(role="customer", user_id=str(account.id))  # type: ignore[arg-type]

    if not claims.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Auth0 token is missing email for customer provisioning",
        )

    inferred_first, inferred_last = _email_name_parts(claims.email)
    permission_list = await get_effective_permission_list_for_role("customer")
    created = await create_user(
        CustomerCreate(
            firstName=first_name or inferred_first,
            lastName=last_name or inferred_last,
            email=claims.email,
            password=seed_password,
            loginType=login_type,
            accountStatus=AccountStatus.ACTIVE,
            permissionList=permission_list,
            auth_provider="auth0",
            auth_subject=claims.sub,
            email_verified=claims.email_verified,
            last_auth_at=claims.iat,
        )
    )
    return created


async def _claims_from_access_token(access_token: str) -> Auth0Claims:
    try:
        return await get_auth0_token_verifier().verify_access_token(access_token)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Auth0 access token") from err


def _map_auth0_error(err: Auth0APIError) -> HTTPException:
    if err.status_code in {400, 401, 403}:
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(err))
    if err.status_code == 409:
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))


async def add_user(user_data: CustomerSignupRequest) -> CustomerOut:
    existing = await get_user(filter_dict={"email": user_data.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Customer Already exists")

    try:
        await signup_email_password(email=str(user_data.email), password=str(user_data.password))
        token_set = await password_login(email=str(user_data.email), password=str(user_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    customer = await _resolve_or_provision_customer(
        claims=claims,
        first_name=user_data.firstName,
        last_name=user_data.lastName,
        login_type=LoginType.email,
        seed_password=str(user_data.password),
    )
    customer.password = ""
    customer.access_token = token_set.access_token
    customer.refresh_token = token_set.refresh_token
    return customer


async def authenticate_user(user_data: CustomerLogin) -> CustomerOut:
    try:
        token_set = await password_login(email=str(user_data.email), password=str(user_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    customer = await _resolve_or_provision_customer(
        claims=claims,
        login_type=LoginType.email,
        seed_password=str(user_data.password),
    )
    customer.password = ""
    customer.access_token = token_set.access_token
    customer.refresh_token = token_set.refresh_token
    return customer


async def refresh_user_tokens_reduce_number_of_logins(
    user_refresh_data: CustomerRefresh,
    expired_access_token: str,
):
    _ = expired_access_token
    try:
        token_set = await refresh_access_token(refresh_token=user_refresh_data.refresh_token)
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    account = await resolve_role_account_for_claims(role="customer", claims=claims)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    customer = await refresh_account_after_update(role="customer", user_id=str(account.id))  # type: ignore[arg-type]
    customer.password = ""
    customer.access_token = token_set.access_token
    customer.refresh_token = token_set.refresh_token or user_refresh_data.refresh_token
    return customer


async def remove_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    result = await delete_user({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")


async def retrieve_user_by_user_id(id: str) -> CustomerOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    result = await get_user({"_id": ObjectId(id)})
    if not result:
        raise HTTPException(status_code=404, detail="Customer not found")
    return result


async def retrieve_users(start=0, stop=100) -> List[CustomerOut]:
    return await get_users(start=start, stop=stop)


async def update_user_by_id(user_id: str, user_data: CustomerUpdate, is_password_getting_changed: bool = False) -> CustomerOut:
    _ = is_password_getting_changed
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    result = await update_user({"_id": ObjectId(user_id)}, user_data)
    if not result:
        raise HTTPException(status_code=404, detail="Customer not found or update failed")
    return result


async def authenticate_user_google(user_data: CustomerSignupRequest) -> CustomerOut:
    # Google auth must be routed through Auth0 Universal Login. This fallback keeps the route contract
    # by using the same Auth0-backed signup/login flow.
    return await add_user(user_data=user_data)
