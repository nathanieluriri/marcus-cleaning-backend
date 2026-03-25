from __future__ import annotations

import os
import time
from bson import ObjectId
from fastapi import HTTPException, status
from typing import List

from authlib.integrations.starlette_client import OAuth
from core.cleaner_onboarding_cache import invalidate_cleaner_onboarding_cache
from core.errors import AppException, ErrorCode
from repositories.cleaner_repo import create_user, delete_user, get_user, get_users, update_user
from repositories.tokens_repo import (
    delete_access_token,
    delete_all_tokens_with_user_id,
    delete_refresh_token,
    get_refresh_tokens,
)
from schemas.cleaner_schema import (
    CleanerCreate,
    CleanerLogin,
    CleanerOnboardingReviewRequest,
    CleanerOnboardingUpsertRequest,
    CleanerOut,
    CleanerRefresh,
    CleanerSignupRequest,
    CleanerUpdate,
    get_cleaner_profile_missing_fields,
)
from schemas.imports import AccountStatus, LoginType, OnboardingStatus
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
    local = (email.split("@", 1)[0] or "cleaner").replace(".", " ").replace("_", " ").strip()
    if not local:
        return "Cleaner", ""
    parts = local.split(" ", 1)
    if len(parts) == 1:
        return parts[0].capitalize(), ""
    return parts[0].capitalize(), parts[1].capitalize()


async def _issue_and_attach_tokens(*, cleaner: CleanerOut) -> CleanerOut:
    access_token, refresh_token = await issue_tokens_for_user(user_id=str(cleaner.id), role="cleaner")
    cleaner.password = ""
    cleaner.access_token = access_token
    cleaner.refresh_token = refresh_token
    return cleaner


async def add_user(user_data: CleanerSignupRequest) -> CleanerOut:
    existing = await get_user(filter_dict={"email": user_data.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Cleaner Already exists")

    permission_list = await get_effective_permission_list_for_role("cleaner")
    created = await create_user(
        CleanerCreate(
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
    return await _issue_and_attach_tokens(cleaner=created)


async def authenticate_user(user_data: CleanerLogin) -> CleanerOut:
    cleaner = await get_user(filter_dict={"email": user_data.email})
    if cleaner is None:
        raise HTTPException(status_code=404, detail="Cleaner not found")

    if not check_password(password=str(user_data.password), hashed=cleaner.password):  # type: ignore[arg-type]
        raise HTTPException(status_code=401, detail="Unathorized, Invalid Login credentials")

    if cleaner.auth_provider != "local" or cleaner.auth_subject:
        cleaner = await update_user_by_id(
            user_id=str(cleaner.id),
            user_data=CleanerUpdate(
                auth_provider="local",
                auth_subject=None,
                last_auth_at=int(time.time()),
            ),
        )
    else:
        cleaner = await update_user_by_id(
            user_id=str(cleaner.id),
            user_data=CleanerUpdate(last_auth_at=int(time.time())),
        )

    return await _issue_and_attach_tokens(cleaner=cleaner)


async def refresh_user_tokens_reduce_number_of_logins(user_refresh_data: CleanerRefresh, expired_access_token: str):
    refresh_obj = await get_refresh_tokens(user_refresh_data.refresh_token)
    if refresh_obj is None:
        raise HTTPException(status_code=404, detail="Invalid refresh token")

    if expired_access_token and refresh_obj.previousAccessToken != expired_access_token:
        await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
        raise HTTPException(status_code=404, detail="Invalid refresh token")

    cleaner = await retrieve_user_by_user_id(id=refresh_obj.userId)
    cleaner = await update_user_by_id(
        user_id=str(cleaner.id),
        user_data=CleanerUpdate(last_auth_at=int(time.time())),
    )
    cleaner = await _issue_and_attach_tokens(cleaner=cleaner)

    await delete_access_token(accessToken=refresh_obj.previousAccessToken)
    await delete_refresh_token(refreshToken=user_refresh_data.refresh_token)
    return cleaner


async def remove_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    result = await delete_user({"_id": ObjectId(user_id)})
    await delete_all_tokens_with_user_id(userId=user_id)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Cleaner not found")


async def retrieve_user_by_user_id(id: str) -> CleanerOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    result = await get_user({"_id": ObjectId(id)})
    if not result:
        raise HTTPException(status_code=404, detail="Cleaner not found")
    return result


async def retrieve_users(start=0, stop=100) -> List[CleanerOut]:
    return await get_users(start=start, stop=stop)


async def update_user_by_id(user_id: str, user_data: CleanerUpdate, is_password_getting_changed: bool = False) -> CleanerOut:
    _ = is_password_getting_changed
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    result = await update_user({"_id": ObjectId(user_id)}, user_data)
    if not result:
        raise HTTPException(status_code=404, detail="Cleaner not found or update failed")
    return result


async def upsert_cleaner_onboarding_profile(
    *,
    cleaner_id: str,
    payload: CleanerOnboardingUpsertRequest,
) -> CleanerOut:
    cleaner = await retrieve_user_by_user_id(id=cleaner_id)
    next_status = cleaner.onboarding_status
    next_rejection_reason = cleaner.rejection_reason
    if cleaner.onboarding_status == OnboardingStatus.REJECTED:
        next_status = OnboardingStatus.PENDING
        next_rejection_reason = None

    updated = await update_user_by_id(
        cleaner_id,
        CleanerUpdate(
            profile=payload.profile,
            onboarding_status=next_status,
            rejection_reason=next_rejection_reason,
        ),
    )
    invalidate_cleaner_onboarding_cache(cleaner_id)
    return updated


async def review_cleaner_onboarding(
    *,
    cleaner_id: str,
    payload: CleanerOnboardingReviewRequest,
) -> CleanerOut:
    cleaner = await retrieve_user_by_user_id(id=cleaner_id)
    if payload.status == OnboardingStatus.APPROVED:
        missing_fields = get_cleaner_profile_missing_fields(cleaner.profile)
        if missing_fields:
            raise AppException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                code=ErrorCode.VALIDATION_FAILED,
                message="Cleaner profile is incomplete for onboarding approval",
                details={"missing_fields": missing_fields},
            )

    updated = await update_user_by_id(
        cleaner_id,
        CleanerUpdate(
            onboarding_status=payload.status,
            rejection_reason=payload.rejection_reason if payload.status == OnboardingStatus.REJECTED else None,
        ),
    )
    invalidate_cleaner_onboarding_cache(cleaner_id)
    return updated


async def authenticate_user_google(user_data: CleanerSignupRequest) -> CleanerOut:
    cleaner = await get_user(filter_dict={"email": user_data.email})
    if cleaner is None:
        permission_list = await get_effective_permission_list_for_role("cleaner")
        first_name = user_data.firstName or _email_name_parts(str(user_data.email))[0]
        last_name = user_data.lastName or _email_name_parts(str(user_data.email))[1]
        cleaner = await create_user(
            CleanerCreate(
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
        cleaner = await update_user_by_id(
            user_id=str(cleaner.id),
            user_data=CleanerUpdate(
                auth_provider="local",
                auth_subject=None,
                email_verified=True,
                last_auth_at=int(time.time()),
            ),
        )

    return await _issue_and_attach_tokens(cleaner=cleaner)
