from __future__ import annotations

import os
import time
from typing import List

from authlib.integrations.starlette_client import OAuth
from bson import ObjectId
from fastapi import HTTPException, status

from repositories.customer_repo import create_user, delete_user, get_user, get_users, update_user
from repositories.tokens_repo import (
    delete_access_token,
    delete_all_tokens_with_user_id,
    delete_refresh_token,
    get_refresh_tokens,
)
from schemas.customer_schema import (
    CustomerCreate,
    CustomerLogin,
    CustomerOut,
    CustomerRefresh,
    CustomerSignupRequest,
    CustomerUpdate,
)
from schemas.imports import AccountStatus, LoginType
from security.hash import check_password
from services.auth_helpers import issue_tokens_for_user
from services.role_permission_template_service import get_effective_permission_list_for_role

oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def _email_name_parts(email: str) -> tuple[str, str]:
    local = (email.split("@", 1)[0] or "user").replace(".", " ").replace("_", " ").strip()
    if not local:
        return "User", ""
    parts = local.split(" ", 1)
    if len(parts) == 1:
        return parts[0].capitalize(), ""
    return parts[0].capitalize(), parts[1].capitalize()


async def _issue_and_attach_tokens(*, customer: CustomerOut) -> CustomerOut:
    access_token, refresh_token = await issue_tokens_for_user(user_id=str(customer.id), role="customer")
    customer.password = ""
    customer.access_token = access_token
    customer.refresh_token = refresh_token
    return customer


async def add_user(user_data: CustomerSignupRequest) -> CustomerOut:
    existing = await get_user(filter_dict={"email": user_data.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Customer Already exists")
    permission_list = await get_effective_permission_list_for_role("customer")
    created = await create_user(
        CustomerCreate(
            firstName=user_data.firstName,
            lastName=user_data.lastName,
            email=user_data.email,
            password=user_data.password,
            loginType=LoginType.email,
            accountStatus=AccountStatus.ACTIVE,
            permissionList=permission_list,
            auth_provider="local",
            auth_subject=None,
            email_verified=False,
            last_auth_at=int(time.time()),
        )
    )
    return await _issue_and_attach_tokens(customer=created)


async def authenticate_user(user_data: CustomerLogin) -> CustomerOut:
    customer = await get_user(filter_dict={"email": user_data.email})
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    if not check_password(password=str(user_data.password), hashed=customer.password):  # type: ignore[arg-type]
        raise HTTPException(status_code=401, detail="Unathorized, Invalid Login credentials")

    if customer.auth_provider != "local" or customer.auth_subject:
        customer = await update_user_by_id(
            user_id=str(customer.id),
            user_data=CustomerUpdate(
                auth_provider="local",
                auth_subject=None,
                last_auth_at=int(time.time()),
            ),
        )
    else:
        customer = await update_user_by_id(
            user_id=str(customer.id),
            user_data=CustomerUpdate(last_auth_at=int(time.time())),
        )

    return await _issue_and_attach_tokens(customer=customer)


async def refresh_user_tokens_reduce_number_of_logins(
    user_refresh_data: CustomerRefresh,
    expired_access_token: str,
):
    refresh_obj = await get_refresh_tokens(user_refresh_data.refresh_token)
    if refresh_obj is None:
        raise HTTPException(status_code=404, detail="Invalid refresh token")

    if expired_access_token and refresh_obj.previousAccessToken != expired_access_token:
        await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
        raise HTTPException(status_code=404, detail="Invalid refresh token")

    customer = await retrieve_user_by_user_id(id=refresh_obj.userId)
    customer = await update_user_by_id(
        user_id=str(customer.id),
        user_data=CustomerUpdate(last_auth_at=int(time.time())),
    )
    customer = await _issue_and_attach_tokens(customer=customer)

    await delete_access_token(accessToken=refresh_obj.previousAccessToken)
    await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
    return customer


async def remove_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    result = await delete_user({"_id": ObjectId(user_id)})
    await delete_all_tokens_with_user_id(userId=user_id)
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
    customer = await get_user(filter_dict={"email": user_data.email})
    if customer is None:
        permission_list = await get_effective_permission_list_for_role("customer")
        first_name = user_data.firstName or _email_name_parts(str(user_data.email))[0]
        last_name = user_data.lastName or _email_name_parts(str(user_data.email))[1]
        customer = await create_user(
            CustomerCreate(
                firstName=first_name,
                lastName=last_name,
                email=user_data.email,
                password=user_data.password or "",
                loginType=LoginType.google,
                accountStatus=AccountStatus.ACTIVE,
                permissionList=permission_list,
                auth_provider="local",
                auth_subject=None,
                email_verified=True,
                last_auth_at=int(time.time()),
            )
        )
    else:
        customer = await update_user_by_id(
            user_id=str(customer.id),
            user_data=CustomerUpdate(
                auth_provider="local",
                auth_subject=None,
                email_verified=True,
                last_auth_at=int(time.time()),
            ),
        )

    return await _issue_and_attach_tokens(customer=customer)
