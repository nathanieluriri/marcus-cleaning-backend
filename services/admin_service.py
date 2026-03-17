from __future__ import annotations

import logging
import os
import re
import time

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING
from fastapi import HTTPException, status
from typing import List

from core.settings import get_settings
from core.database import db
from repositories.admin_repo import create_admin, delete_admin, get_admin, get_admins, update_admin
from repositories.cleaner_repo import get_user as get_cleaner, get_users as get_cleaners
from repositories.customer_repo import get_user as get_customer, get_users as get_customers
from schemas.admin_directory_schema import (
    ADMIN_LIST_DEFAULT_START,
    ADMIN_LIST_DEFAULT_STOP,
    ADMIN_LIST_MAX_STOP,
    AdminCleanerDetailItem,
    AdminCleanerListItem,
    AdminCustomerDetailItem,
    AdminCustomerListItem,
    AdminOnboardingQueueItem,
    compute_sla_age_hours,
)
from schemas.admin_schema import AdminBase, AdminCreate, AdminOut, AdminRefresh, AdminUpdate
from schemas.cleaner_schema import CleanerOut, get_cleaner_profile_missing_fields
from schemas.imports import PermissionList
from schemas.imports import AccountStatus, OnboardingStatus
from security.auth0_client import Auth0APIError, password_login, refresh_access_token, signup_email_password
from security.auth0_verifier import Auth0Claims, get_auth0_token_verifier
from services.auth_identity_service import refresh_account_after_update, resolve_role_account_for_claims
from services.super_admin_identity_service import (
    SUPER_ADMIN_STATIC_ID,
    get_known_super_admin_subject,
    is_known_super_admin_subject,
    register_super_admin_subject,
)
from security.permissions import default_permissions

logger = logging.getLogger(__name__)


def _is_super_admin_account(*, admin_id: str | None, admin_email: str | None) -> bool:
    normalized_id = (admin_id or "").strip()
    normalized_email = (admin_email or "").strip().lower()
    env_email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
    if normalized_id and normalized_id == SUPER_ADMIN_STATIC_ID:
        return True
    if env_email and normalized_email and normalized_email == env_email:
        return True
    return False


def _is_env_super_admin_credentials(*, email: str, password: str) -> bool:
    env_email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
    env_password = (os.getenv("SUPER_ADMIN_PASSWORD") or "").strip()
    normalized_email = email.strip().lower()
    return bool(env_email and env_password and normalized_email == env_email and password == env_password)


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
        settings = get_settings()
        logger.warning(
            "Auth0 access token verification failed error=%s configured_issuer=%s configured_audience=%s allowed_azp=%s",
            str(err),
            settings.auth0_issuer or f"https://{settings.auth0_domain}/",
            settings.auth0_audience,
            settings.auth0_allowed_azp,
        )
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
    is_env_super_admin_login = _is_env_super_admin_credentials(
        email=str(admin_data.email),
        password=str(admin_data.password),
    )
    if is_env_super_admin_login:
        logger.info("Super admin credential precheck passed email=%s", str(admin_data.email).strip().lower())

    try:
        token_set = await password_login(email=str(admin_data.email), password=str(admin_data.password))
    except Auth0APIError as err:
        logger.warning(
            "Admin Auth0 password login failed email=%s status_code=%s details=%s",
            str(admin_data.email),
            err.status_code,
            err.details,
        )
        raise _map_auth0_error(err) from err

    if is_env_super_admin_login:
        claims = await _claims_from_access_token(token_set.access_token)
        register_super_admin_subject(claims.sub)
        resolved_super_admin = await retrieve_admin_by_admin_id(id=SUPER_ADMIN_STATIC_ID)
        resolved_super_admin.password = ""
        resolved_super_admin.access_token = token_set.access_token
        resolved_super_admin.refresh_token = token_set.refresh_token
        logger.info(
            "Super admin authenticated via env precheck and Auth0 token issuance subject=%s",
            claims.sub,
        )
        return resolved_super_admin

    claims = await _claims_from_access_token(token_set.access_token)
    register_super_admin_subject(claims.sub)
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

    resolved = await refresh_account_after_update(role="admin", user_id=str(admin.id))  # type: ignore[arg-type]
    resolved.password = ""
    resolved.access_token = token_set.access_token
    resolved.refresh_token = token_set.refresh_token
    return resolved # type: ignore


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
    register_super_admin_subject(claims.sub)
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None and is_known_super_admin_subject(claims.sub):
        admin = await retrieve_admin_by_admin_id(id=SUPER_ADMIN_STATIC_ID)
    if admin is None:
        logger.warning("Admin refresh role resolution miss subject=%s", claims.sub)
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
    if _is_super_admin_account(admin_id=result.id, admin_email=str(result.email)):
        result.permissionList = PermissionList.model_validate(default_permissions().model_dump(mode="json"))
        if not result.auth_provider:
            result.auth_provider = "auth0"
        if not result.auth_subject:
            result.auth_subject = get_known_super_admin_subject()
        if not result.email_verified:
            result.email_verified = True
        if result.last_auth_at is None:
            result.last_auth_at = int(time.time())
        if not result.full_name:
            result.full_name = "Super Admin"
        result.password = ""
        if result.date_created is None:
            result.date_created = int(time.time())
        if result.last_updated is None:
            result.last_updated = int(time.time())
    return result


async def retrieve_admins(start=0, stop=100) -> List[AdminOut]:
    return await get_admins(start=start, stop=stop)


def _normalize_window(*, start: int, stop: int, max_stop: int = ADMIN_LIST_MAX_STOP) -> tuple[int, int]:
    if stop > max_stop:
        stop = max_stop
    if start >= stop:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid pagination window: start must be smaller than stop",
        )
    return start, stop


def _to_admin_customer_list_item(customer: object) -> AdminCustomerListItem:
    customer_id = str(getattr(customer, "id", "") or "")
    return AdminCustomerListItem(
        id=customer_id,
        _id=customer_id,
        firstName=getattr(customer, "firstName", ""),
        lastName=getattr(customer, "lastName", ""),
        email=str(getattr(customer, "email", "")),
        phoneNumber=getattr(customer, "phoneNumber", None),
        accountStatus=getattr(customer, "accountStatus"),
        date_created=getattr(customer, "date_created", None),
        last_updated=getattr(customer, "last_updated", None),
    )


def _to_admin_customer_detail_item(customer: object) -> AdminCustomerDetailItem:
    list_item = _to_admin_customer_list_item(customer)
    return AdminCustomerDetailItem(
        **list_item.model_dump(),
        avatarDocumentId=getattr(customer, "avatarDocumentId", None),
        permissionList=getattr(customer, "permissionList", None).model_dump(mode="json") # type: ignore[arg-type]
        if getattr(customer, "permissionList", None) is not None
        else None,
    )


def _to_admin_cleaner_list_item(cleaner: object) -> AdminCleanerListItem:
    cleaner_id = str(getattr(cleaner, "id", "") or "")
    return AdminCleanerListItem(
        id=cleaner_id,
        _id=cleaner_id,
        firstName=getattr(cleaner, "firstName", ""),
        lastName=getattr(cleaner, "lastName", ""),
        email=str(getattr(cleaner, "email", "")),
        accountStatus=getattr(cleaner, "accountStatus"),
        onboarding_status=getattr(cleaner, "onboarding_status"),
        rejection_reason=getattr(cleaner, "rejection_reason", None),
        date_created=getattr(cleaner, "date_created", None),
        last_updated=getattr(cleaner, "last_updated", None),
    )


def _cleaner_profile_completeness(cleaner: CleanerOut) -> tuple[int, list[str]]:
    missing_fields = get_cleaner_profile_missing_fields(cleaner.profile)
    if not missing_fields:
        return 100, []
    # This model currently has one gating requirement (`profile`) so completeness is binary.
    return 0, missing_fields


def _to_admin_onboarding_queue_item(cleaner: CleanerOut) -> AdminOnboardingQueueItem:
    cleaner_id = str(getattr(cleaner, "id", "") or "")
    completeness, missing_requirements = _cleaner_profile_completeness(cleaner)
    first_name = getattr(cleaner, "firstName", "") or ""
    last_name = getattr(cleaner, "lastName", "") or ""
    full_name = " ".join(part for part in [first_name, last_name] if part).strip() or "Unknown Cleaner"
    submitted_at = getattr(cleaner, "date_created", None)
    return AdminOnboardingQueueItem(
        id=cleaner_id,
        _id=cleaner_id,
        fullName=full_name,
        email=str(getattr(cleaner, "email", "")),
        onboarding_status=getattr(cleaner, "onboarding_status"),
        profileCompleteness=completeness,
        missingRequirements=missing_requirements,
        submittedAt=submitted_at,
        slaAgeHours=compute_sla_age_hours(submitted_at),
    )


def _to_admin_cleaner_detail_item(cleaner: object) -> AdminCleanerDetailItem:
    list_item = _to_admin_cleaner_list_item(cleaner)
    return AdminCleanerDetailItem(
        **list_item.model_dump(),
        profile=getattr(cleaner, "profile", None).model_dump(mode="json")# type: ignore[arg-type]
        if getattr(cleaner, "profile", None) is not None
        else None,
    )


async def retrieve_admin_customers(
    *,
    start: int = ADMIN_LIST_DEFAULT_START,
    stop: int = ADMIN_LIST_DEFAULT_STOP,
    search: str | None = None,
    account_status: AccountStatus | None = None,
    from_epoch: int | None = None,
    to_epoch: int | None = None,
) -> list[AdminCustomerListItem]:
    normalized_start, normalized_stop = _normalize_window(start=start, stop=stop)
    filter_dict: dict[str, object] = {}
    if account_status is not None:
        filter_dict["accountStatus"] = account_status.value
    if from_epoch is not None or to_epoch is not None:
        date_filter: dict[str, int] = {}
        if from_epoch is not None:
            date_filter["$gte"] = from_epoch
        if to_epoch is not None:
            date_filter["$lte"] = to_epoch
        filter_dict["date_created"] = date_filter
    if search:
        escaped_search = re.escape(search.strip())
        if escaped_search:
            filter_dict["$or"] = [
                {"firstName": {"$regex": escaped_search, "$options": "i"}},
                {"lastName": {"$regex": escaped_search, "$options": "i"}},
                {"email": {"$regex": escaped_search, "$options": "i"}},
            ]

    customers = await get_customers(filter_dict=filter_dict, start=normalized_start, stop=normalized_stop)
    return [_to_admin_customer_list_item(customer) for customer in customers]


async def retrieve_admin_cleaners(
    *,
    start: int = ADMIN_LIST_DEFAULT_START,
    stop: int = ADMIN_LIST_DEFAULT_STOP,
    onboarding_status: OnboardingStatus | None = None,
) -> list[AdminCleanerListItem]:
    normalized_start, normalized_stop = _normalize_window(start=start, stop=stop)
    filter_dict: dict[str, object] | None = None
    if onboarding_status is not None:
        filter_dict = {"onboarding_status": onboarding_status.value}
    cleaners = await get_cleaners(filter_dict=filter_dict, start=normalized_start, stop=normalized_stop) # type: ignore
    return [_to_admin_cleaner_list_item(cleaner) for cleaner in cleaners]


async def retrieve_admin_cleaner_detail(*, cleaner_id: str) -> AdminCleanerDetailItem:
    if not ObjectId.is_valid(cleaner_id):
        raise HTTPException(status_code=400, detail="Invalid cleaner ID format")

    cleaner = await get_cleaner({"_id": ObjectId(cleaner_id)})
    if cleaner is None:
        raise HTTPException(status_code=404, detail="Cleaner not found")
    return _to_admin_cleaner_detail_item(cleaner)


async def retrieve_admin_customer_detail(*, customer_id: str) -> AdminCustomerDetailItem:
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")

    customer = await get_customer({"_id": ObjectId(customer_id)})
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _to_admin_customer_detail_item(customer)


async def retrieve_admin_onboarding_queue(
    *,
    start: int = 0,
    stop: int = 50,
    sort: str = "submitted_at",
    search: str | None = None,
) -> list[AdminOnboardingQueueItem]:
    normalized_start, normalized_stop = _normalize_window(start=start, stop=stop, max_stop=200)

    filter_dict: dict[str, object] = {
        "onboarding_status": OnboardingStatus.PENDING.value,
    }
    if search:
        escaped_search = re.escape(search.strip())
        if escaped_search:
            filter_dict["$or"] = [
                {"firstName": {"$regex": escaped_search, "$options": "i"}},
                {"lastName": {"$regex": escaped_search, "$options": "i"}},
                {"email": {"$regex": escaped_search, "$options": "i"}},
            ]

    sort_mapping: dict[str, tuple[str, int]] = {
        "submitted_at": ("date_created", DESCENDING),
        "sla_age": ("date_created", ASCENDING),
        "name": ("firstName", ASCENDING),
    }
    sort_field, sort_order = sort_mapping.get(sort, sort_mapping["submitted_at"])
    limit = normalized_stop - normalized_start

    cursor = db.cleaners.find(filter_dict).sort(sort_field, sort_order).skip(normalized_start).limit(limit)
    rows: list[AdminOnboardingQueueItem] = []
    async for row in cursor:
        cleaner = CleanerOut(**row)
        rows.append(_to_admin_onboarding_queue_item(cleaner))
    return rows


async def update_admin_by_id(admin_id: str, admin_data: AdminUpdate, is_password_getting_changed: bool = False) -> AdminOut:
    _ = is_password_getting_changed
    if not ObjectId.is_valid(admin_id):
        raise HTTPException(status_code=400, detail="Invalid admin ID format")

    result = await update_admin({"_id": ObjectId(admin_id)}, admin_data)
    if not result:
        raise HTTPException(status_code=404, detail="Admin not found or update failed")
    return result
