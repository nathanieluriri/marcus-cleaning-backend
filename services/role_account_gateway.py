from __future__ import annotations

from typing import Literal

from bson import ObjectId
from fastapi import HTTPException, status

from repositories.admin_repo import get_admin, update_admin
from repositories.cleaner_repo import get_user as get_cleaner
from repositories.cleaner_repo import update_user as update_cleaner
from repositories.customer_repo import get_user as get_customer
from repositories.customer_repo import update_user as update_customer
from schemas.admin_schema import AdminUpdate
from schemas.cleaner_schema import CleanerUpdate
from schemas.customer_schema import CustomerUpdate

RoleName = Literal["admin", "cleaner", "customer"]


async def find_account_by_subject(*, role: RoleName, subject: str):
    if role == "admin":
        return await get_admin({"auth_subject": subject})
    if role == "cleaner":
        return await get_cleaner({"auth_subject": subject})
    return await get_customer({"auth_subject": subject})


async def find_account_by_email(*, role: RoleName, email: str):
    if role == "admin":
        return await get_admin({"email": email})
    if role == "cleaner":
        return await get_cleaner({"email": email})
    return await get_customer({"email": email})


async def update_auth_identity_fields(
    *,
    role: RoleName,
    user_id: str,
    auth_provider: str,
    auth_subject: str,
    email_verified: bool,
    last_auth_at: int,
):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {role} ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    if role == "admin":
        return await update_admin(
            filter_dict,
            AdminUpdate(
                auth_provider=auth_provider,
                auth_subject=auth_subject,
                email_verified=email_verified,
                last_auth_at=last_auth_at,
            ),
        )
    if role == "cleaner":
        return await update_cleaner(
            filter_dict,
            CleanerUpdate(
                auth_provider=auth_provider,
                auth_subject=auth_subject,
                email_verified=email_verified,
                last_auth_at=last_auth_at,
            ),
        )
    return await update_customer(
        filter_dict,
        CustomerUpdate(
            auth_provider=auth_provider,
            auth_subject=auth_subject,
            email_verified=email_verified,
            last_auth_at=last_auth_at,
        ),
    )


async def retrieve_account_by_id(*, role: RoleName, user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {role} ID format")

    filter_dict = {"_id": ObjectId(user_id)}
    if role == "admin":
        account = await get_admin(filter_dict)
    elif role == "cleaner":
        account = await get_cleaner(filter_dict)
    else:
        account = await get_customer(filter_dict)

    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{role.capitalize()} not found")
    return account
