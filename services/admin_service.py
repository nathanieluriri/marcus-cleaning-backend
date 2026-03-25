from __future__ import annotations

import logging
import os
import re
import time

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING, ReturnDocument
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
    AdminUserAutocompleteItem,
    AdminUserAutocompleteResult,
    compute_sla_age_hours,
)
from schemas.admin_schema import AdminBase, AdminCreate, AdminOut, AdminRefresh, AdminUpdate
from schemas.cleaner_schema import CleanerOut, get_cleaner_profile_missing_fields
from schemas.place import PlaceOut
from schemas.saved_address import CustomerSavedAddressCreateRequest, SavedAddressOut
from schemas.imports import Permission, PermissionList
from schemas.imports import AccountStatus, OnboardingStatus
from security.auth0_client import (
    Auth0APIError,
    auth0_user_profile_by_email,
    delete_auth0_user,
    password_login,
    refresh_access_token,
    signup_email_password,
)
from security.auth0_verifier import Auth0Claims, get_auth0_token_verifier
from services.auth_identity_service import refresh_account_after_update, resolve_role_account_for_claims
from services.super_admin_identity_service import (
    SUPER_ADMIN_STATIC_ID,
    get_known_super_admin_subject,
    is_known_super_admin_subject,
    register_super_admin_subject,
)
from services.saved_address_service import create_my_saved_address, list_my_saved_addresses
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


def is_super_admin_actor(*, admin_id: str | None, admin_email: str | None) -> bool:
    return _is_super_admin_account(admin_id=admin_id, admin_email=admin_email)


def is_main_super_admin_actor(*, admin_email: str | None) -> bool:
    env_email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
    normalized_email = (admin_email or "").strip().lower()
    return bool(env_email and normalized_email and normalized_email == env_email)


def _is_env_super_admin_credentials(*, email: str, password: str) -> bool:
    env_email = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()
    env_password = (os.getenv("SUPER_ADMIN_PASSWORD") or "").strip()
    normalized_email = email.strip().lower()
    return bool(env_email and env_password and normalized_email == env_email and password == env_password)


def _infer_admin_full_name_from_email(email: str) -> str:
    local = (email.split("@", 1)[0] or "admin").replace(".", " ").replace("_", " ").strip()
    if not local:
        return "Admin User"
    words = [part.capitalize() for part in local.split() if part]
    return " ".join(words) or "Admin User"


def _resolve_admin_email_for_provisioning(*, claims_email: str | None, login_email: str) -> str:
    normalized_claims_email = (claims_email or "").strip()
    if normalized_claims_email:
        return normalized_claims_email
    return login_email.strip()


def _minimal_admin_permission_list() -> PermissionList:
    return PermissionList(
        permissions=[
            Permission(
                name="get_my_admin",
                methods=["GET"],
                path="/admins/profile",
                key="GET:/admins/profile",
                description="Admin profile fetched successfully",
            ),
            Permission(
                name="request_admin_privilege_elevation",
                methods=["POST"],
                path="/admins/access/request-elevation",
                key="POST:/admins/access/request-elevation",
                description="Admin elevation request submitted successfully",
            ),
            Permission(
                name="get_my_admin_elevation_request_status",
                methods=["GET"],
                path="/admins/access/request-elevation/status",
                key="GET:/admins/access/request-elevation/status",
                description="Admin elevation request status fetched successfully",
            ),
            Permission(
                name="get_admin_permission_groups",
                methods=["GET"],
                path="/admins/access/permission-groups",
                key="GET:/admins/access/permission-groups",
                description="Admin permission groups fetched successfully",
            ),
        ]
    )


def _map_auth0_error(err: Auth0APIError) -> HTTPException:
    details = err.details if isinstance(err.details, dict) else {}
    code = str(details.get("code") or details.get("error") or "").strip().lower()
    description = str(details.get("description") or details.get("error_description") or "").strip()
    detail_message = description or str(err)

    def _http_exc(*, status_code: int, message: str, error_code: str, extra_details: dict | None = None) -> HTTPException:
        payload = {
            "message": message,
            "code": error_code,
            "details": {
                "auth0_status_code": err.status_code,
                "auth0_code": code or None,
                "auth0_message": detail_message,
            },
        }
        if extra_details:
            payload["details"].update(extra_details)
        return HTTPException(status_code=status_code, detail=payload)

    if err.status_code == 400:
        if code in {"invalid_grant", "invalid_user_password", "unauthorized"}:
            return _http_exc(
                status_code=status.HTTP_401_UNAUTHORIZED,
                message="Invalid email or password",
                error_code="AUTH0_INVALID_CREDENTIALS",
            )
        if code in {"user_exists", "email_exists", "identifier_exists"}:
            return _http_exc(
                status_code=status.HTTP_409_CONFLICT,
                message="Identity already exists in Auth0",
                error_code="AUTH0_IDENTITY_EXISTS",
            )
        if code == "invalid_signup":
            lowered = detail_message.lower()
            if "exist" in lowered or "already" in lowered:
                return _http_exc(
                    status_code=status.HTTP_409_CONFLICT,
                    message="Identity already exists in Auth0",
                    error_code="AUTH0_IDENTITY_EXISTS",
                )
            return _http_exc(
                status_code=status.HTTP_400_BAD_REQUEST,
                message="Invalid signup request",
                error_code="AUTH0_INVALID_SIGNUP",
                extra_details={
                    "hint": (
                        "Check Auth0 DB connection enablement, password policy, "
                        "and whether the email already exists in Auth0."
                    ),
                },
            )
        return _http_exc(
            status_code=status.HTTP_400_BAD_REQUEST,
            message=detail_message,
            error_code="AUTH0_BAD_REQUEST",
        )
    if err.status_code in {401, 403}:
        return _http_exc(
            status_code=status.HTTP_401_UNAUTHORIZED,
            message="Auth0 authorization failed",
            error_code="AUTH0_UNAUTHORIZED",
        )
    if err.status_code == 409:
        return _http_exc(
            status_code=status.HTTP_409_CONFLICT,
            message=detail_message,
            error_code="AUTH0_CONFLICT",
        )
    return _http_exc(
        status_code=status.HTTP_502_BAD_GATEWAY,
        message="Auth0 upstream error",
        error_code="AUTH0_UPSTREAM_ERROR",
    )


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


def _normalize_password_for_auth0(raw_password: str | bytes) -> str:
    if isinstance(raw_password, str):
        return raw_password
    try:
        return raw_password.decode("utf-8") # type: ignore
    except UnicodeDecodeError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password encoding") from err


async def add_admin(admin_data: AdminCreate, *, raw_password: str | bytes | None = None) -> AdminOut:
    minimal_permissions = admin_data.permissionList or _minimal_admin_permission_list()
    password_for_auth0 = _normalize_password_for_auth0(raw_password if raw_password is not None else admin_data.password)
    try:
        auth0_profile = await auth0_user_profile_by_email(email=str(admin_data.email))
    except Auth0APIError as err:
        logger.warning(
            "Auth0 precheck users-by-email failed email=%s status_code=%s details=%s",
            str(admin_data.email),
            err.status_code,
            err.details,
        )
        auth0_profile = None

    auth_subject: str
    email_verified: bool
    last_auth_at: int | None
    issued_access_token: str | None = None
    issued_refresh_token: str | None = None
    if auth0_profile is not None:
        auth_subject = auth0_profile.user_id
        email_verified = bool(auth0_profile.email_verified)
        last_auth_at = int(time.time())
    else:
        try:
            await signup_email_password(email=str(admin_data.email), password=password_for_auth0)
            token_set = await password_login(email=str(admin_data.email), password=password_for_auth0)
        except Auth0APIError as err:
            raise _map_auth0_error(err) from err

        claims = await _claims_from_access_token(token_set.access_token)
        auth_subject = claims.sub
        email_verified = claims.email_verified
        last_auth_at = claims.iat
        issued_access_token = token_set.access_token
        issued_refresh_token = token_set.refresh_token

    existing_by_subject = await get_admin({"auth_subject": auth_subject})
    if existing_by_subject is not None:
        if _is_super_admin_account(admin_id=existing_by_subject.id, admin_email=str(existing_by_subject.email)):
            raise HTTPException(status_code=409, detail="Super admin account cannot be replaced")
        if not ObjectId.is_valid(str(existing_by_subject.id)):
            raise HTTPException(status_code=400, detail="Invalid admin ID format")
        updated = await update_admin(
            {"_id": ObjectId(str(existing_by_subject.id))},
            AdminUpdate(
                full_name=admin_data.full_name,
                email=admin_data.email,
                password=password_for_auth0,
                accountStatus=admin_data.accountStatus,
                permissionList=minimal_permissions,
                auth_provider="auth0",
                auth_subject=auth_subject,
                email_verified=email_verified,
                last_auth_at=last_auth_at,
            ),
        )
        updated.password = ""
        if hasattr(updated, "access_token"):
            updated.access_token = issued_access_token
        if hasattr(updated, "refresh_token"):
            updated.refresh_token = issued_refresh_token
        return updated

    existing_by_email = await get_admin({"email": admin_data.email})
    if existing_by_email is not None:
        if _is_super_admin_account(admin_id=existing_by_email.id, admin_email=str(existing_by_email.email)):
            raise HTTPException(status_code=409, detail="Super admin account cannot be replaced")
        if not ObjectId.is_valid(str(existing_by_email.id)):
            raise HTTPException(status_code=400, detail="Invalid admin ID format")
        updated = await update_admin(
            {"_id": ObjectId(str(existing_by_email.id))},
            AdminUpdate(
                full_name=admin_data.full_name,
                email=admin_data.email,
                password=password_for_auth0,
                accountStatus=admin_data.accountStatus,
                permissionList=minimal_permissions,
                auth_provider="auth0",
                auth_subject=auth_subject, 
                email_verified=email_verified,
                last_auth_at=last_auth_at,
            ),
        )
        updated.password = ""
        if hasattr(updated, "access_token"):
            updated.access_token = issued_access_token
        if hasattr(updated, "refresh_token"):
            updated.refresh_token = issued_refresh_token
        return updated

    admin_payload = admin_data.model_dump(
        exclude={
            "password",
            "permissionList",
            "auth_provider",
            "auth_subject",
            "email_verified",
            "last_auth_at",
        }
    )
    created = await create_admin(
        AdminCreate(
            **admin_payload,
            password=password_for_auth0,
            permissionList=minimal_permissions,
            auth_provider="auth0",
            auth_subject=auth_subject,
            email_verified=email_verified,
            last_auth_at=last_auth_at,
        )
    )
    created.password = ""
    if hasattr(created, "access_token"):
        created.access_token = issued_access_token
    if hasattr(created, "refresh_token"):
        created.refresh_token = issued_refresh_token
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
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None:
        provision_email = _resolve_admin_email_for_provisioning(
            claims_email=claims.email,
            login_email=str(admin_data.email),
        )
        if not provision_email:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Unable to resolve admin email for provisioning",
            )
        created = await create_admin(
            AdminCreate(
                full_name=getattr(admin_data, "full_name", None) or _infer_admin_full_name_from_email(provision_email),
                email=provision_email,
                password=str(getattr(admin_data, "password", "")),
                invited_by=SUPER_ADMIN_STATIC_ID,
                accountStatus=AccountStatus.ACTIVE,
                permissionList=_minimal_admin_permission_list(),
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
    admin = await resolve_role_account_for_claims(role="admin", claims=claims)
    if admin is None and is_known_super_admin_subject(claims.sub):
        admin = await retrieve_admin_by_admin_id(id=SUPER_ADMIN_STATIC_ID)
    if admin is None and claims.email:
        created = await create_admin(
            AdminCreate(
                full_name=_infer_admin_full_name_from_email(claims.email),
                email=claims.email,
                password="auth0-managed",
                invited_by=SUPER_ADMIN_STATIC_ID,
                accountStatus=AccountStatus.ACTIVE,
                permissionList=_minimal_admin_permission_list(),
                auth_provider="auth0",
                auth_subject=claims.sub,
                email_verified=claims.email_verified,
                last_auth_at=claims.iat,
            )
        )
        created.password = ""
        created.access_token = token_set.access_token
        created.refresh_token = token_set.refresh_token or admin_refresh_data.refresh_token
        return created
    if admin is None:
        logger.warning("Admin refresh role resolution miss subject=%s", claims.sub)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")

    resolved = await refresh_account_after_update(role="admin", user_id=str(admin.id))  # type: ignore[arg-type]
    resolved.password = ""
    resolved.access_token = token_set.access_token
    resolved.refresh_token = token_set.refresh_token or admin_refresh_data.refresh_token
    return resolved


async def remove_admin(admin_id: str):
    return await remove_admin_with_auth0(admin_id=admin_id)


def _http_error(*, status_code: int, message: str, code: str, details: dict | None = None) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "message": message,
            "code": code,
            "details": details,
        },
    )


async def remove_admin_with_auth0(*, admin_id: str) -> dict:
    if not ObjectId.is_valid(admin_id):
        raise _http_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            message="Invalid admin ID format",
            code="INVALID_ADMIN_ID",
        )

    admin = await retrieve_admin_by_admin_id(id=admin_id)
    if _is_super_admin_account(admin_id=admin.id, admin_email=str(admin.email)):
        raise _http_error(
            status_code=status.HTTP_403_FORBIDDEN,
            message="Main super admin account cannot be deleted",
            code="ADMIN_DELETE_FORBIDDEN",
        )

    auth0_status = "skipped"
    auth_subject = (admin.auth_subject or "").strip()
    if auth_subject:
        try:
            auth0_status = await delete_auth0_user(auth_subject=auth_subject)
        except Auth0APIError as err:
            raise _http_error(
                status_code=status.HTTP_502_BAD_GATEWAY,
                message="Failed to delete admin from Auth0",
                code="AUTH0_DELETE_FAILED",
                details={
                    "auth_subject": auth_subject,
                    "auth0_status_code": err.status_code,
                    "auth0_message": str(err),
                    "auth0_details": err.details if isinstance(err.details, dict) else None,
                },
            ) from err

    result = await delete_admin({"_id": ObjectId(admin_id)})
    if result.deleted_count == 0:
        raise _http_error(
            status_code=status.HTTP_404_NOT_FOUND,
            message="Admin not found",
            code="ADMIN_NOT_FOUND",
        )

    return {
        "deleted": True,
        "adminId": admin_id,
        "auth0Status": auth0_status,
    }


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
        allow_admin_selection=bool(getattr(cleaner, "allow_admin_selection", False)),
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


def _to_admin_autocomplete_item(*, row: dict, role: str) -> AdminUserAutocompleteItem:
    row_id = row.get("_id")
    normalized_id = str(row_id) if row_id is not None else ""
    return AdminUserAutocompleteItem(
        id=normalized_id,
        _id=normalized_id,
        role=role,
        firstName=str(row.get("firstName") or ""),
        lastName=str(row.get("lastName") or ""),
        email=str(row.get("email") or ""),
        onboarding_status=row.get("onboarding_status") if role == "cleaner" else None,
        allow_admin_selection=bool(row.get("allow_admin_selection", False)) if role == "cleaner" else None,
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


async def retrieve_admin_customer_places(
    *,
    admin_id: str,
    customer_id: str,
    start: int = 0,
    stop: int = 20,
) -> list[PlaceOut]:
    if not (admin_id or "").strip():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin identity is required")
    _ = await retrieve_admin_customer_detail(customer_id=customer_id)
    addresses = await list_my_saved_addresses(user_id=customer_id, start=start, stop=stop)
    deduped_by_place_id: dict[str, PlaceOut] = {}
    for address in addresses:
        place = address.place
        if not place.place_id:
            continue
        deduped_by_place_id[place.place_id] = place
    return list(deduped_by_place_id.values())


async def create_admin_customer_place(
    *,
    admin_id: str,
    customer_id: str,
    payload: CustomerSavedAddressCreateRequest,
) -> SavedAddressOut:
    if not (admin_id or "").strip():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin identity is required")
    _ = await retrieve_admin_customer_detail(customer_id=customer_id)
    return await create_my_saved_address(
        user_id=customer_id,
        payload=payload,
        created_by_admin_id=admin_id,
    )


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


async def retrieve_admin_user_autocomplete(*, query: str, limit: int = 10) -> AdminUserAutocompleteResult:
    normalized_query = query.strip()
    if len(normalized_query) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Query must be at least 2 characters long",
        )

    escaped_query = re.escape(normalized_query)
    customer_or_filters: list[dict[str, object]] = [
        {"email": {"$regex": escaped_query, "$options": "i"}},
        {"firstName": {"$regex": escaped_query, "$options": "i"}},
        {"lastName": {"$regex": escaped_query, "$options": "i"}},
    ]
    cleaner_or_filters: list[dict[str, object]] = [
        {"email": {"$regex": escaped_query, "$options": "i"}},
        {"firstName": {"$regex": escaped_query, "$options": "i"}},
        {"lastName": {"$regex": escaped_query, "$options": "i"}},
    ]
    if ObjectId.is_valid(normalized_query):
        object_id = ObjectId(normalized_query)
        customer_or_filters.append({"_id": object_id})
        cleaner_or_filters.append({"_id": object_id})

    projection = {
        "_id": 1,
        "firstName": 1,
        "lastName": 1,
        "email": 1,
        "onboarding_status": 1,
        "allow_admin_selection": 1,
    }
    customers_cursor = (
        db.customers.find({"$or": customer_or_filters}, projection)
        .sort("date_created", DESCENDING)
        .limit(limit)
    )
    cleaners_cursor = (
        db.cleaners.find({"$or": cleaner_or_filters}, projection)
        .sort("date_created", DESCENDING)
        .limit(limit)
    )

    customers: list[AdminUserAutocompleteItem] = []
    cleaners: list[AdminUserAutocompleteItem] = []

    async for row in customers_cursor:
        customers.append(_to_admin_autocomplete_item(row=row, role="customer"))

    async for row in cleaners_cursor:
        cleaners.append(_to_admin_autocomplete_item(row=row, role="cleaner"))

    return AdminUserAutocompleteResult(
        query=normalized_query,
        customers=customers,
        cleaners=cleaners,
    )


async def update_admin_by_id(admin_id: str, admin_data: AdminUpdate, is_password_getting_changed: bool = False) -> AdminOut:
    _ = is_password_getting_changed
    if not ObjectId.is_valid(admin_id):
        raise HTTPException(status_code=400, detail="Invalid admin ID format")

    result = await update_admin({"_id": ObjectId(admin_id)}, admin_data)
    if not result:
        raise HTTPException(status_code=404, detail="Admin not found or update failed")
    return result


async def submit_admin_elevation_request(
    *,
    admin_id: str,
    reason: str,
    requested_permissions: list[str] | None = None,
    requested_permission_groups: list[str] | None = None,
) -> dict:
    now = int(time.time())
    normalized_requested_permission_groups = _normalize_permission_keys(requested_permission_groups)
    normalized_requested_permissions = _normalize_permission_keys(requested_permissions)
    group_permissions = await _permissions_from_group_names(normalized_requested_permission_groups)
    merged_requested_permissions = _normalize_permission_keys(normalized_requested_permissions + group_permissions)
    pending = await db.admin_privilege_requests.find_one({"admin_id": admin_id, "status": "PENDING"})
    if pending is not None:
        existing_request_id = pending.get("_id")
        return {
            "requestId": str(existing_request_id) if existing_request_id is not None else None,
            "status": "PENDING",
            "message": "A pending elevation request already exists",
        }

    payload = {
        "admin_id": admin_id,
        "reason": reason,
        "requested_permissions": merged_requested_permissions,
        "requested_permission_groups": normalized_requested_permission_groups,
        "granted_permissions": [],
        "status": "PENDING",
        "reviewed_by": None,
        "review_note": None,
        "reviewed_at": None,
        "date_created": now,
        "last_updated": now,
    }
    inserted = await db.admin_privilege_requests.insert_one(payload)
    return {
        "requestId": str(inserted.inserted_id),
        "status": "PENDING",
        "message": "Elevation request submitted",
    }


async def get_latest_admin_elevation_request_status(*, admin_id: str) -> dict:
    request_row = await db.admin_privilege_requests.find_one(
        {"admin_id": admin_id},
        sort=[("date_created", DESCENDING), ("_id", DESCENDING)],
    )
    if request_row is None:
        return {
            "requestId": None,
            "status": "NONE",
            "requestedPermissions": [],
            "reason": None,
            "decisionNote": None,
            "dateCreated": None,
            "lastUpdated": None,
        }

    request_id = request_row.get("_id")
    raw_requested_permissions = request_row.get("requested_permissions")
    requested_permissions = (
        [str(item) for item in raw_requested_permissions]
        if isinstance(raw_requested_permissions, list)
        else []
    )
    raw_group_names = request_row.get("requested_permission_groups")
    requested_permission_groups = (
        [str(item) for item in raw_group_names]
        if isinstance(raw_group_names, list)
        else []
    )
    raw_granted_permissions = request_row.get("granted_permissions")
    granted_permissions = (
        [str(item) for item in raw_granted_permissions]
        if isinstance(raw_granted_permissions, list)
        else []
    )
    return {
        "requestId": str(request_id) if request_id is not None else None,
        "status": str(request_row.get("status") or "PENDING").upper(),
        "requestedPermissions": requested_permissions,
        "requestedPermissionGroups": requested_permission_groups,
        "grantedPermissions": granted_permissions,
        "reason": request_row.get("reason"),
        "decisionNote": request_row.get("decision_note"),
        "reviewedBy": request_row.get("reviewed_by"),
        "reviewedAt": request_row.get("reviewed_at"),
        "dateCreated": request_row.get("date_created"),
        "lastUpdated": request_row.get("last_updated"),
    }


def _normalize_permission_keys(keys: list[str] | None) -> list[str]:
    if not keys:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for key in keys:
        item = str(key).strip()
        if not item or item in seen:
            continue
        seen.add(item)
        normalized.append(item)
    return normalized


def _built_in_permission_groups() -> list[dict]:
    all_keys = sorted(
        key for key in [permission.key for permission in default_permissions().permissions] if isinstance(key, str) and key
    )
    all_key_set = set(all_keys)

    def _pick(preferred_keys: list[str]) -> list[str]:
        return [key for key in preferred_keys if key in all_key_set]

    specialized_groups: list[dict] = [
        {
            "id": "concierge_operator",
            "name": "concierge_operator",
            "description": "Concierge booking operations for agent-assisted booking flows",
            "permissions": _pick(
                [
                    "GET:/admins/users/autocomplete",
                    "GET:/admins/customers/{customer_id}/places",
                    "POST:/admins/customers/{customer_id}/places",
                    "GET:/admins/customers",
                    "GET:/admins/customers/{customer_id}",
                    "GET:/admins/cleaners",
                    "GET:/admins/cleaners/{cleaner_id}",
                    "GET:/admins/service-definitions",
                    "GET:/admins/add-ons",
                    "GET:/admins/concierge-bookings",
                    "GET:/admins/concierge-bookings/{id}",
                    "POST:/admins/concierge-bookings",
                    "POST:/admins/concierge-bookings/create-booking",
                    "PATCH:/admins/concierge-bookings/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "promo_handler",
            "name": "promo_handler",
            "description": "Promo code management and discount campaign operations",
            "permissions": _pick(
                [
                    "GET:/admins/promo-codes",
                    "GET:/admins/promo-codes/{id}",
                    "POST:/admins/promo-codes",
                    "PATCH:/admins/promo-codes/{id}",
                    "DELETE:/admins/promo-codes/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "pricing_manager",
            "name": "pricing_manager",
            "description": "Dynamic pricing and service pricing model governance",
            "permissions": _pick(
                [
                    "GET:/admins/pricing-rules",
                    "GET:/admins/pricing-rules/{id}",
                    "POST:/admins/pricing-rules",
                    "PATCH:/admins/pricing-rules/{id}",
                    "DELETE:/admins/pricing-rules/{id}",
                    "GET:/admins/service-definitions",
                    "GET:/admins/service-definitions/{id}",
                    "PATCH:/admins/service-definitions/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "service_catalog_manager",
            "name": "service_catalog_manager",
            "description": "Service definitions and add-on catalog management",
            "permissions": _pick(
                [
                    "GET:/admins/service-definitions",
                    "GET:/admins/service-definitions/{id}",
                    "POST:/admins/service-definitions",
                    "PATCH:/admins/service-definitions/{id}",
                    "DELETE:/admins/service-definitions/{id}",
                    "GET:/admins/add-ons",
                    "GET:/admins/add-ons/{id}",
                    "POST:/admins/add-ons",
                    "PATCH:/admins/add-ons/{id}",
                    "DELETE:/admins/add-ons/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "service_area_manager",
            "name": "service_area_manager",
            "description": "Service area and coverage boundary management",
            "permissions": _pick(
                [
                    "GET:/admins/service-areas",
                    "GET:/admins/service-areas/{id}",
                    "POST:/admins/service-areas",
                    "PATCH:/admins/service-areas/{id}",
                    "DELETE:/admins/service-areas/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "onboarding_reviewer",
            "name": "onboarding_reviewer",
            "description": "Cleaner onboarding queue and review decisions",
            "permissions": _pick(
                [
                    "GET:/admins/cleaners",
                    "GET:/admins/cleaners/{cleaner_id}",
                    "GET:/admins/onboarding/queue",
                    "PATCH:/admins/cleaners/{cleaner_id}/onboarding-review",
                    "GET:/admins/cleaner-tags",
                    "PATCH:/admins/cleaner-tags/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "customer_support_desk",
            "name": "customer_support_desk",
            "description": "Customer/cleaner support visibility and chat intervention",
            "permissions": _pick(
                [
                    "GET:/admins/users/autocomplete",
                    "GET:/admins/customers/{customer_id}/places",
                    "POST:/admins/customers/{customer_id}/places",
                    "GET:/admins/customers",
                    "GET:/admins/customers/{customer_id}",
                    "GET:/admins/cleaners",
                    "GET:/admins/cleaners/{cleaner_id}",
                    "GET:/admins/chat-interventions",
                    "POST:/admins/chat-interventions",
                    "PATCH:/admins/chat-interventions/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "claims_reviewer",
            "name": "claims_reviewer",
            "description": "Claim intake and decision workflow operations",
            "permissions": _pick(
                [
                    "GET:/admins/claim-reviews",
                    "GET:/admins/claim-reviews/{id}",
                    "POST:/admins/claim-reviews",
                    "PATCH:/admins/claim-reviews/{id}",
                    "POST:/admins/claim-reviews/{id}/decision",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "credits_adjustments_manager",
            "name": "credits_adjustments_manager",
            "description": "Service credits and payout adjustment operations",
            "permissions": _pick(
                [
                    "GET:/admins/service-credits",
                    "GET:/admins/service-credits/{id}",
                    "POST:/admins/service-credits",
                    "POST:/admins/service-credits/grant",
                    "PATCH:/admins/service-credits/{id}",
                    "GET:/admins/service-credits/balance/{customer_id}",
                    "GET:/admins/payout-adjustments",
                    "POST:/admins/payout-adjustments",
                    "PATCH:/admins/payout-adjustments/{id}",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "broadcast_manager",
            "name": "broadcast_manager",
            "description": "System broadcast drafting and dispatch operations",
            "permissions": _pick(
                [
                    "GET:/admins/broadcasts",
                    "GET:/admins/broadcasts/{id}",
                    "POST:/admins/broadcasts",
                    "PATCH:/admins/broadcasts/{id}",
                    "POST:/admins/broadcasts/dispatch",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "monitoring_analyst",
            "name": "monitoring_analyst",
            "description": "Monitoring dashboard and alert workflow operations",
            "permissions": _pick(
                [
                    "GET:/admins/monitoring/overview",
                    "GET:/admins/monitoring/auth/heatmap",
                    "GET:/admins/monitoring/permissions/denied-top",
                    "GET:/admins/monitoring/sessions/anomalies",
                    "GET:/admins/monitoring/alerts",
                    "GET:/admins/monitoring/alerts/sla",
                    "PATCH:/admins/monitoring/alerts/{alert_id}/read",
                    "PATCH:/admins/monitoring/alerts/{alert_id}/ack",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "audit_compliance_reviewer",
            "name": "audit_compliance_reviewer",
            "description": "Audit history and export access for compliance workflows",
            "permissions": _pick(
                [
                    "GET:/admins/monitoring/audit/history",
                    "GET:/admins/monitoring/audit/history/{event_id}",
                    "POST:/admins/monitoring/audit/export",
                    "GET:/admins/monitoring/audit/export/{export_id}",
                    "GET:/admins/monitoring/audit/export/{export_id}/download",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "reports_viewer",
            "name": "reports_viewer",
            "description": "User growth and signup trend report access",
            "permissions": _pick(
                [
                    "GET:/admins/reports/users/summary",
                    "GET:/admins/reports/users/signups-trend",
                ]
            ),
            "type": "built_in",
        },
        {
            "id": "access_reviewer",
            "name": "access_reviewer",
            "description": "Permission-group and elevation-request review operations",
            "permissions": _pick(
                [
                    "GET:/admins/permissions/catalog",
                    "GET:/admins/access/requests",
                    "PATCH:/admins/access/requests/{request_id}/decision",
                    "GET:/admins/access/permission-groups",
                    "POST:/admins/access/permission-groups",
                ]
            ),
            "type": "built_in",
        },
    ]

    return [
        {
            "id": "admin",
            "name": "admin",
            "description": "Default admin permission set",
            "permissions": all_keys,
            "type": "built_in",
        },
        {
            "id": "super_admin",
            "name": "super_admin",
            "description": "All admin permissions plus static super-admin bypass",
            "permissions": all_keys,
            "type": "built_in",
        },
        *specialized_groups,
    ]


async def _permissions_from_group_names(group_names: list[str] | None) -> list[str]:
    normalized_group_names = _normalize_permission_keys(group_names)
    if not normalized_group_names:
        return []
    built_in_by_name = {group["name"]: group for group in _built_in_permission_groups()}
    collected: list[str] = []
    for group_name in normalized_group_names:
        built_in = built_in_by_name.get(group_name)
        if built_in is not None:
            collected.extend(_normalize_permission_keys(built_in.get("permissions")))
            continue
        query: dict[str, object]
        if ObjectId.is_valid(group_name):
            query = {"_id": ObjectId(group_name)}
        else:
            query = {"name": group_name}
        row = await db.admin_permission_groups.find_one(query)
        if row is None:
            continue
        collected.extend(_normalize_permission_keys(row.get("permissions")))
    return _normalize_permission_keys(collected)


async def list_permission_groups() -> dict:
    built_in = _built_in_permission_groups()
    custom_groups: list[dict] = []
    cursor = db.admin_permission_groups.find({}).sort("date_created", DESCENDING)
    async for row in cursor:
        group_id = row.get("_id")
        custom_groups.append(
            {
                "id": str(group_id) if group_id is not None else None,
                "name": str(row.get("name") or ""),
                "description": row.get("description"),
                "permissions": _normalize_permission_keys(row.get("permissions")),
                "type": "custom",
                "createdBy": row.get("created_by"),
                "dateCreated": row.get("date_created"),
                "lastUpdated": row.get("last_updated"),
            }
        )
    return {"builtIn": built_in, "custom": custom_groups}


async def create_permission_group(
    *,
    created_by: str,
    name: str,
    description: str | None,
    permissions: list[str],
) -> dict:
    normalized_name = name.strip()
    if not normalized_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Group name is required")
    built_in_names = {str(group.get("name")) for group in _built_in_permission_groups()}
    if normalized_name in built_in_names:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Permission group name already exists")
    normalized_permissions = _normalize_permission_keys(permissions)
    if not normalized_permissions:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="At least one permission is required")
    existing = await db.admin_permission_groups.find_one({"name": normalized_name})
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Permission group name already exists")
    now = int(time.time())
    payload = {
        "name": normalized_name,
        "description": (description or "").strip() or None,
        "permissions": normalized_permissions,
        "created_by": created_by,
        "date_created": now,
        "last_updated": now,
    }
    inserted = await db.admin_permission_groups.insert_one(payload)
    return {
        "id": str(inserted.inserted_id),
        "name": normalized_name,
        "description": payload["description"],
        "permissions": normalized_permissions,
        "createdBy": created_by,
        "dateCreated": now,
        "lastUpdated": now,
    }


async def list_admin_elevation_requests(*, status_filter: str | None = None, start: int = 0, stop: int = 50) -> list[dict]:
    query: dict[str, object] = {}
    if status_filter:
        query["status"] = status_filter.strip().upper()
    limit = max(stop - start, 1)
    cursor = db.admin_privilege_requests.find(query).sort("date_created", DESCENDING).skip(start).limit(limit)
    rows: list[dict] = []
    async for row in cursor:
        request_id = row.get("_id")
        rows.append(
            {
                "requestId": str(request_id) if request_id is not None else None,
                "adminId": row.get("admin_id"),
                "status": str(row.get("status") or "PENDING").upper(),
                "reason": row.get("reason"),
                "requestedPermissions": _normalize_permission_keys(row.get("requested_permissions")),
                "requestedPermissionGroups": _normalize_permission_keys(row.get("requested_permission_groups")),
                "grantedPermissions": _normalize_permission_keys(row.get("granted_permissions")),
                "reviewedBy": row.get("reviewed_by"),
                "reviewedAt": row.get("reviewed_at"),
                "decisionNote": row.get("review_note"),
                "dateCreated": row.get("date_created"),
                "lastUpdated": row.get("last_updated"),
            }
        )
    return rows


async def review_admin_elevation_request(
    *,
    request_id: str,
    reviewer_admin_id: str,
    decision: str,
    granted_permissions: list[str] | None = None,
    note: str | None = None,
) -> dict:
    if not ObjectId.is_valid(request_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request ID format")
    normalized_decision = decision.strip().upper()
    if normalized_decision not in {"APPROVED", "REJECTED"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Decision must be APPROVED or REJECTED")
    request_row = await db.admin_privilege_requests.find_one({"_id": ObjectId(request_id)})
    if request_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Elevation request not found")
    current_status = str(request_row.get("status") or "PENDING").upper()
    if current_status != "PENDING":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Elevation request has already been reviewed")

    now = int(time.time())
    normalized_grants = _normalize_permission_keys(granted_permissions)
    if normalized_decision == "APPROVED":
        target_admin_id = str(request_row.get("admin_id") or "")
        if not ObjectId.is_valid(target_admin_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target admin ID")
        target_admin = await retrieve_admin_by_admin_id(id=target_admin_id)
        requested_keys = _normalize_permission_keys(request_row.get("requested_permissions"))
        effective_grants = normalized_grants or requested_keys
        if not effective_grants:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Approved request must include at least one granted permission",
            )
        await update_admin(
            {"_id": ObjectId(target_admin_id)},
            AdminUpdate(
                permissionList=PermissionList(
                    permissions=[
                        Permission(
                            name=key,
                            methods=[key.split(":", 1)[0]] if ":" in key else ["GET"],
                            path=key.split(":", 1)[1] if ":" in key else "",
                            key=key,
                            description=None,
                        )
                        for key in effective_grants
                    ]
                ),
                last_auth_at=target_admin.last_auth_at,
            ),
        )
        normalized_grants = effective_grants
    else:
        normalized_grants = []

    updated = await db.admin_privilege_requests.find_one_and_update(
        {"_id": ObjectId(request_id)},
        {
            "$set": {
                "status": normalized_decision,
                "granted_permissions": normalized_grants,
                "review_note": (note or "").strip() or None,
                "reviewed_by": reviewer_admin_id,
                "reviewed_at": now,
                "last_updated": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to persist request decision")
    return {
        "requestId": request_id,
        "status": normalized_decision,
        "grantedPermissions": normalized_grants,
        "decisionNote": updated.get("review_note"),
        "reviewedBy": reviewer_admin_id,
        "reviewedAt": now,
    }
