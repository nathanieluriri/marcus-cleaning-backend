from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException, status
from typing import List

from core.cleaner_onboarding_cache import invalidate_cleaner_onboarding_cache
from core.errors import AppException, ErrorCode
from repositories.cleaner_repo import create_user, delete_user, get_user, get_users, update_user
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
from security.auth0_client import Auth0APIError, password_login, refresh_access_token, signup_email_password
from security.auth0_verifier import Auth0Claims, get_auth0_token_verifier
from services.auth_identity_service import refresh_account_after_update, resolve_role_account_for_claims
from services.role_permission_template_service import get_effective_permission_list_for_role


def _email_name_parts(email: str) -> tuple[str, str]:
    local = (email.split("@", 1)[0] or "cleaner").replace(".", " ").replace("_", " ").strip()
    if not local:
        return "Cleaner", ""
    parts = local.split(" ", 1)
    if len(parts) == 1:
        return parts[0].capitalize(), ""
    return parts[0].capitalize(), parts[1].capitalize()


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


async def _resolve_or_provision_cleaner(
    *,
    claims: Auth0Claims,
    first_name: str | None = None,
    last_name: str | None = None,
    login_type: LoginType,
    seed_password: str,
) -> CleanerOut:
    account = await resolve_role_account_for_claims(role="cleaner", claims=claims)
    if account is not None:
        return await refresh_account_after_update(role="cleaner", user_id=str(account.id))  # type: ignore[arg-type]

    if not claims.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Auth0 token is missing email for cleaner provisioning",
        )

    inferred_first, inferred_last = _email_name_parts(claims.email)
    permission_list = await get_effective_permission_list_for_role("cleaner")
    created = await create_user(
        CleanerCreate(
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


async def add_user(user_data: CleanerSignupRequest) -> CleanerOut:
    existing = await get_user(filter_dict={"email": user_data.email})
    if existing is not None:
        raise HTTPException(status_code=409, detail="Cleaner Already exists")

    try:
        await signup_email_password(email=str(user_data.email), password=str(user_data.password))
        token_set = await password_login(email=str(user_data.email), password=str(user_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    cleaner = await _resolve_or_provision_cleaner(
        claims=claims,
        first_name=user_data.firstName,
        last_name=user_data.lastName,
        login_type=LoginType.email,
        seed_password=str(user_data.password),
    )
    cleaner.password = ""
    cleaner.access_token = token_set.access_token
    cleaner.refresh_token = token_set.refresh_token
    return cleaner


async def authenticate_user(user_data: CleanerLogin) -> CleanerOut:
    try:
        token_set = await password_login(email=str(user_data.email), password=str(user_data.password))
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    cleaner = await _resolve_or_provision_cleaner(
        claims=claims,
        login_type=LoginType.email,
        seed_password=str(user_data.password),
    )
    cleaner.password = ""
    cleaner.access_token = token_set.access_token
    cleaner.refresh_token = token_set.refresh_token
    return cleaner


async def refresh_user_tokens_reduce_number_of_logins(user_refresh_data: CleanerRefresh, expired_access_token: str):
    _ = expired_access_token
    try:
        token_set = await refresh_access_token(refresh_token=user_refresh_data.refresh_token)
    except Auth0APIError as err:
        raise _map_auth0_error(err) from err

    claims = await _claims_from_access_token(token_set.access_token)
    account = await resolve_role_account_for_claims(role="cleaner", claims=claims)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cleaner not found")
    cleaner = await refresh_account_after_update(role="cleaner", user_id=str(account.id))  # type: ignore[arg-type]
    cleaner.password = ""
    cleaner.access_token = token_set.access_token
    cleaner.refresh_token = token_set.refresh_token or user_refresh_data.refresh_token
    return cleaner


async def remove_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    result = await delete_user({"_id": ObjectId(user_id)})
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
    return await add_user(user_data=user_data)
