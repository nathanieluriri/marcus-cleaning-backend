from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import HTTPException, status

from core.database import db
from schemas.booking import BookingBase
from schemas.customer_app_contract import (
    AccountDeactivateRequestContract,
    AccountDeleteRequestContract,
    AccountLifecycleActionContract,
    AccountLifecycleActionResponseContract,
    AccountLifecycleSettingsContract,
    AuthPasswordResetRequestContract,
    AuthResponseContract,
    AuthSignInRequestContract,
    AuthSignUpRequestContract,
    CustomerProfileContract,
    CustomerProfileEditRequestContract,
    AuthUserContract,
    BookingCreateRequestContract,
    BookingCreateResponseContract,
    BookingExtraContract,
    CleanerCardContract,
    CleanerCertificationContract,
    CleanerFiltersContract,
    CleanerProfileContract,
    CleanerReviewContract,
    CleanerReviewFiltersContract,
    CleanerReviewsPageContract,
    HomePayloadContract,
    NotificationChannelsContract,
    NotificationPreferencesContract,
    NotificationPreferencesPatchContract,
    NotificationTypeContract,
    NotificationItemContract,
    PendingAccountLifecycleActionContract,
    QuietHoursContract,
    RevokeOtherSessionsResponseContract,
    SecurityPreferencesContract,
    SecurityPreferencesPatchContract,
    SessionControlContract,
    SettingsSnapshotContract,
)
from schemas.customer_schema import CustomerLogin, CustomerSignupRequest, CustomerUpdate
from schemas.imports import AccountStatus, AddOn, CleaningServices, Duration, Extra
from security.principal import AuthPrincipal
from core.storage.manager import DocumentStorageManager
from repositories.document_repo import get_document_by_id
from repositories.tokens_repo import delete_all_tokens_with_user_id, delete_other_tokens_with_user_id
from services.booking_service import create_booking_for_customer
from services.cleaner_service import retrieve_user_by_user_id as retrieve_cleaner_by_id
from services.cleaner_service import retrieve_users as retrieve_cleaners
from services.customer_service import add_user, authenticate_user, remove_user, retrieve_user_by_user_id, update_user_by_id
from services.review_service import retrieve_reviews
from services.saved_address_service import list_my_saved_addresses

_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")
_ACCOUNT_DELETE_CONFIRM_TEXT = "DELETE"


def _default_notification_preferences() -> NotificationPreferencesContract:
    return NotificationPreferencesContract(
        enabled=True,
        channels=NotificationChannelsContract(
            push=True,
            email=True,
            sms=False,
        ),
        quietHours=QuietHoursContract(
            enabled=False,
            startTime="22:00",
            endTime="07:00",
            timezone="UTC",
        ),
    )


def _default_security_preferences() -> SecurityPreferencesContract:
    return SecurityPreferencesContract(
        biometricLoginEnabled=False,
        twoFactorEnabled=False,
    )


def _default_settings_snapshot() -> SettingsSnapshotContract:
    return SettingsSnapshotContract(
        notifications=_default_notification_preferences(),
        privacy={},
        security=_default_security_preferences(),
        sessions=SessionControlContract(),
        accountLifecycle=AccountLifecycleSettingsContract(),
        legal={},
    )


def _merge_notification_preferences(
    current: NotificationPreferencesContract,
    payload: NotificationPreferencesPatchContract,
) -> NotificationPreferencesContract:
    merged = current.model_dump()
    updates = payload.model_dump(exclude_none=True)

    if "enabled" in updates:
        merged["enabled"] = updates["enabled"]

    channels = updates.get("channels")
    if isinstance(channels, dict):
        merged_channels = dict(merged["channels"])
        merged_channels.update(channels)
        merged["channels"] = merged_channels

    quiet_hours = updates.get("quietHours")
    if isinstance(quiet_hours, dict):
        merged_quiet_hours = dict(merged["quietHours"])
        merged_quiet_hours.update(quiet_hours)
        merged["quietHours"] = merged_quiet_hours

    return NotificationPreferencesContract.model_validate(merged)


def _merge_security_preferences(
    current: SecurityPreferencesContract,
    payload: SecurityPreferencesPatchContract,
) -> SecurityPreferencesContract:
    merged = current.model_dump()
    merged.update(payload.model_dump(exclude_none=True))
    return SecurityPreferencesContract.model_validate(merged)


def _coerce_effective_epoch(effective_at: datetime | None) -> int:
    if effective_at is None:
        return int(time.time())
    if effective_at.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="effectiveAt must include timezone",
        )
    return int(effective_at.timestamp())


def _is_scheduled(effective_epoch: int) -> bool:
    return effective_epoch > int(time.time())


async def _find_pending_account_action(customer_id: str) -> PendingAccountLifecycleActionContract | None:
    try:
        row = await db.account_lifecycle_jobs.find_one(
            {
                "userId": customer_id,
                "status": "pending",
            },
            sort=[("effectiveAt", 1)],
        )
    except Exception:
        return None

    if not row:
        return None

    action_value = str(row.get("action") or AccountLifecycleActionContract.DEACTIVATE.value)
    action = (
        AccountLifecycleActionContract(action_value)
        if action_value in {value.value for value in AccountLifecycleActionContract}
        else AccountLifecycleActionContract.DEACTIVATE
    )
    return PendingAccountLifecycleActionContract(
        action=action,
        effectiveAt=_epoch_to_datetime(int(row.get("effectiveAt") or time.time())),
        status=str(row.get("status") or "pending"),
    )


async def _build_session_control(customer_id: str) -> SessionControlContract:
    try:
        active_count = await db.accessToken.count_documents({"userId": customer_id})
    except Exception:
        active_count = 1
    revocable = max(int(active_count) - 1, 0)
    return SessionControlContract(
        activeSessionCount=int(active_count),
        revocableSessionCount=revocable,
        canRevokeOtherSessions=revocable > 0,
    )


async def fetch_settings_snapshot_contract(*, customer_id: str) -> SettingsSnapshotContract:
    defaults = _default_settings_snapshot()
    try:
        row = await db.user_settings.find_one({"userId": customer_id})
    except Exception:
        row = None

    if not row:
        return defaults

    try:
        notifications = NotificationPreferencesContract.model_validate(
            row.get("notifications") or defaults.notifications.model_dump()
        )
    except Exception:
        notifications = defaults.notifications

    try:
        security = SecurityPreferencesContract.model_validate(
            row.get("security") or defaults.security.model_dump()
        )
    except Exception:
        security = defaults.security

    sessions = await _build_session_control(customer_id)
    pending_action = await _find_pending_account_action(customer_id)
    account_lifecycle = AccountLifecycleSettingsContract(pendingAction=pending_action)

    return SettingsSnapshotContract(
        notifications=notifications,
        privacy=row.get("privacy") or {},
        security=security,
        sessions=sessions,
        accountLifecycle=account_lifecycle,
        legal=row.get("legal") or {},
    )


async def update_notification_preferences_contract(
    *,
    customer_id: str,
    payload: NotificationPreferencesPatchContract,
) -> NotificationPreferencesContract:
    current_snapshot = await fetch_settings_snapshot_contract(customer_id=customer_id)
    merged = _merge_notification_preferences(current=current_snapshot.notifications, payload=payload)

    now_epoch = int(time.time())
    try:
        await db.user_settings.update_one(
            {"userId": customer_id},
            {
                "$set": {
                    "userId": customer_id,
                    "notifications": merged.model_dump(),
                    "lastUpdated": now_epoch,
                },
                "$setOnInsert": {"dateCreated": now_epoch},
            },
            upsert=True,
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update notification preferences",
        ) from err

    return merged


async def revoke_other_sessions_contract(
    *,
    customer_id: str,
    current_access_token_id: str,
) -> RevokeOtherSessionsResponseContract:
    access_deleted, refresh_deleted = await delete_other_tokens_with_user_id(
        user_id=customer_id,
        current_access_token_id=current_access_token_id,
    )
    return RevokeOtherSessionsResponseContract(
        revokedAccessSessions=access_deleted,
        revokedRefreshSessions=refresh_deleted,
    )


async def _create_lifecycle_job(
    *,
    customer_id: str,
    action: AccountLifecycleActionContract,
    effective_epoch: int,
) -> None:
    existing = await _find_pending_account_action(customer_id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending account lifecycle action already exists",
        )
    await db.account_lifecycle_jobs.insert_one(
        {
            "userId": customer_id,
            "role": "customer",
            "action": action.value,
            "effectiveAt": effective_epoch,
            "status": "pending",
            "createdAt": int(time.time()),
        }
    )


async def _apply_customer_deactivation(customer_id: str) -> None:
    if not ObjectId.is_valid(customer_id):
        raise HTTPException(status_code=400, detail="Invalid customer ID format")
    result = await db.customers.update_one(
        {"_id": ObjectId(customer_id)},
        {
            "$set": {
                "accountStatus": AccountStatus.INACTIVE.value,
                "last_updated": int(time.time()),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    await delete_all_tokens_with_user_id(userId=customer_id)


async def request_account_deactivation_contract(
    *,
    customer_id: str,
    payload: AccountDeactivateRequestContract,
) -> AccountLifecycleActionResponseContract:
    effective_epoch = _coerce_effective_epoch(payload.effectiveAt)
    if _is_scheduled(effective_epoch):
        await _create_lifecycle_job(
            customer_id=customer_id,
            action=AccountLifecycleActionContract.DEACTIVATE,
            effective_epoch=effective_epoch,
        )
        return AccountLifecycleActionResponseContract(
            accepted=True,
            scheduled=True,
            action=AccountLifecycleActionContract.DEACTIVATE,
            effectiveAt=_epoch_to_datetime(effective_epoch),
        )

    await _apply_customer_deactivation(customer_id)
    return AccountLifecycleActionResponseContract(
        accepted=True,
        scheduled=False,
        action=AccountLifecycleActionContract.DEACTIVATE,
        effectiveAt=_epoch_to_datetime(effective_epoch),
    )


async def request_account_deletion_contract(
    *,
    customer_id: str,
    payload: AccountDeleteRequestContract,
) -> AccountLifecycleActionResponseContract:
    if payload.confirmationText != _ACCOUNT_DELETE_CONFIRM_TEXT:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"confirmationText must equal '{_ACCOUNT_DELETE_CONFIRM_TEXT}'",
        )

    effective_epoch = _coerce_effective_epoch(payload.effectiveAt)
    if _is_scheduled(effective_epoch):
        await _create_lifecycle_job(
            customer_id=customer_id,
            action=AccountLifecycleActionContract.DELETE,
            effective_epoch=effective_epoch,
        )
        return AccountLifecycleActionResponseContract(
            accepted=True,
            scheduled=True,
            action=AccountLifecycleActionContract.DELETE,
            effectiveAt=_epoch_to_datetime(effective_epoch),
        )

    await remove_user(user_id=customer_id)
    return AccountLifecycleActionResponseContract(
        accepted=True,
        scheduled=False,
        action=AccountLifecycleActionContract.DELETE,
        effectiveAt=_epoch_to_datetime(effective_epoch),
    )


async def process_due_account_lifecycle_jobs(*, limit: int = 100) -> None:
    now_epoch = int(time.time())
    try:
        cursor = db.account_lifecycle_jobs.find(
            {"status": "pending", "effectiveAt": {"$lte": now_epoch}}
        ).limit(limit)
    except Exception:
        return None

    async for row in cursor:
        job_id = row.get("_id")
        if not job_id:
            continue
        try:
            claimed = await db.account_lifecycle_jobs.find_one_and_update(
                {"_id": job_id, "status": "pending"},
                {"$set": {"status": "processing", "startedAt": now_epoch}},
                return_document=True,
            )
            if not claimed:
                continue

            action = str(claimed.get("action") or "")
            user_id = str(claimed.get("userId") or "")
            if not user_id:
                raise ValueError("missing userId")

            if action == AccountLifecycleActionContract.DEACTIVATE.value:
                await _apply_customer_deactivation(user_id)
            elif action == AccountLifecycleActionContract.DELETE.value:
                await remove_user(user_id=user_id)
            else:
                raise ValueError(f"unsupported lifecycle action: {action}")

            await db.account_lifecycle_jobs.update_one(
                {"_id": job_id},
                {"$set": {"status": "completed", "completedAt": int(time.time())}},
            )
        except Exception as err:
            await db.account_lifecycle_jobs.update_one(
                {"_id": job_id},
                {
                    "$set": {
                        "status": "failed",
                        "error": str(err),
                        "failedAt": int(time.time()),
                    }
                },
            )


async def update_security_preferences_contract(
    *,
    customer_id: str,
    payload: SecurityPreferencesPatchContract,
) -> SecurityPreferencesContract:
    current_snapshot = await fetch_settings_snapshot_contract(customer_id=customer_id)
    merged = _merge_security_preferences(current=current_snapshot.security, payload=payload)

    now_epoch = int(time.time())
    try:
        await db.user_settings.update_one(
            {"userId": customer_id},
            {
                "$set": {
                    "userId": customer_id,
                    "security": merged.model_dump(),
                    "lastUpdated": now_epoch,
                },
                "$setOnInsert": {"dateCreated": now_epoch},
            },
            upsert=True,
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update security preferences",
        ) from err

    return merged


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _epoch_to_datetime(epoch: int | None) -> datetime:
    if not epoch:
        return _utc_now()
    return datetime.fromtimestamp(epoch, timezone.utc)


def _split_full_name(full_name: str) -> tuple[str, str]:
    normalized = " ".join(full_name.strip().split())
    if not normalized:
        return "User", ""
    parts = normalized.split(" ")
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _display_name(first_name: str | None, last_name: str | None) -> str:
    full_name = " ".join([value for value in [first_name or "", last_name or ""] if value.strip()]).strip()
    return full_name or "Cleaner"


def _map_addon(extra_id: str) -> AddOn | None:
    normalized = extra_id.lower()
    if "laundry" in normalized:
        return AddOn.LAUNDRY
    if "fridge" in normalized:
        return AddOn.INSIDE_FRIDGE
    if "window" in normalized:
        return AddOn.WINDOWS
    if "cabinet" in normalized:
        return AddOn.CABINETS
    return None


def _map_service(service_id: str) -> CleaningServices:
    normalized = service_id.lower()
    if "deep" in normalized:
        return CleaningServices.DEEP_CLEAN
    if "office" in normalized:
        return CleaningServices.OFFICE
    if "custom" in normalized:
        return CleaningServices.CUSTOM
    return CleaningServices.STANDARD


async def sign_in_customer_contract(payload: AuthSignInRequestContract) -> AuthResponseContract:
    customer = await authenticate_user(
        CustomerLogin(
            email=payload.email,
            password=payload.password,
        )
    )
    full_name = _display_name(customer.firstName, customer.lastName)
    user = AuthUserContract(
        id=str(customer.id),
        fullName=full_name,
        email=customer.email,
        phoneNumber=customer.phoneNumber,
        avatarUrl=await _resolve_avatar_url(customer.avatarDocumentId),
        createdAt=_epoch_to_datetime(customer.date_created),
    )
    return AuthResponseContract(
        accessToken=customer.access_token or "",
        refreshToken=customer.refresh_token,
        expiresAt=_utc_now() + timedelta(hours=1),
        user=user,
    )


async def sign_up_customer_contract(payload: AuthSignUpRequestContract) -> AuthResponseContract:
    first_name, last_name = _split_full_name(payload.fullName)
    customer = await add_user(
        CustomerSignupRequest(
            firstName=first_name,
            lastName=last_name,
            email=payload.email,
            password=payload.password,
        )
    )
    full_name = _display_name(customer.firstName, customer.lastName)
    user = AuthUserContract(
        id=str(customer.id),
        fullName=full_name,
        email=customer.email,
        phoneNumber=customer.phoneNumber,
        avatarUrl=await _resolve_avatar_url(customer.avatarDocumentId),
        createdAt=_epoch_to_datetime(customer.date_created),
    )
    return AuthResponseContract(
        accessToken=customer.access_token or "",
        refreshToken=customer.refresh_token,
        expiresAt=_utc_now() + timedelta(hours=1),
        user=user,
    )


async def _resolve_avatar_url(avatar_document_id: str | None) -> str | None:
    if not avatar_document_id:
        return None
    doc = await get_document_by_id(document_id=avatar_document_id)
    if doc is None:
        return None
    try:
        provider = DocumentStorageManager.get_instance().provider
        return provider.download_url(object_key=doc.object_key)
    except Exception:
        return None


async def update_customer_profile_contract(
    *,
    customer_id: str,
    payload: CustomerProfileEditRequestContract,
) -> CustomerProfileContract:
    customer = await retrieve_user_by_user_id(id=customer_id)
    provided_fields = payload.model_fields_set
    update_dict: dict[str, str | None] = {}

    if "fullName" in provided_fields:
        if payload.fullName is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fullName cannot be null",
            )
        normalized = " ".join(payload.fullName.strip().split())
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fullName cannot be empty",
            )
        first_name, last_name = _split_full_name(normalized)
        update_dict["firstName"] = first_name
        update_dict["lastName"] = last_name

    if "phoneNumber" in provided_fields:
        if payload.phoneNumber is None:
            update_dict["phoneNumber"] = None
        elif not _E164_RE.fullmatch(payload.phoneNumber):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="phoneNumber must be valid E.164 format",
            )
        else:
            update_dict["phoneNumber"] = payload.phoneNumber

    if "avatarDocumentId" in provided_fields:
        if payload.avatarDocumentId is None:
            update_dict["avatarDocumentId"] = None
        else:
            doc = await get_document_by_id(document_id=payload.avatarDocumentId)
            if doc is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Avatar document not found",
                )
            if doc.owner_id != customer_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You cannot use another user's document as avatar",
                )
            update_dict["avatarDocumentId"] = payload.avatarDocumentId

    if not update_dict:
        updated = customer
    else:
        updated = await update_user_by_id(
            user_id=customer_id,
            user_data=CustomerUpdate(**update_dict),
        )

    full_name = _display_name(updated.firstName, updated.lastName)
    return CustomerProfileContract(
        id=str(updated.id or customer_id),
        fullName=full_name,
        email=updated.email,
        phoneNumber=updated.phoneNumber,
        avatarDocumentId=updated.avatarDocumentId,
        avatarUrl=await _resolve_avatar_url(updated.avatarDocumentId),
        createdAt=_epoch_to_datetime(updated.date_created),
    )


async def request_password_reset_contract(_: AuthPasswordResetRequestContract) -> None:
    # Password reset email pipeline is not wired yet in this repo for customer-app flow.
    return None


async def list_booking_extras_by_service(service_id: str) -> list[BookingExtraContract]:
    service_key = service_id.lower()
    if "deep" in service_key:
        return [
            BookingExtraContract(id="extra_laundry", title="Laundry", price=20.0, isAvailable=True),
            BookingExtraContract(id="extra_windows", title="Windows", price=15.0, isAvailable=True),
            BookingExtraContract(id="extra_fridge", title="Inside Fridge", price=10.0, isAvailable=True),
        ]
    if "office" in service_key:
        return [
            BookingExtraContract(id="extra_cabinets", title="Cabinets", price=18.0, isAvailable=True),
            BookingExtraContract(id="extra_windows", title="Windows", price=22.0, isAvailable=True),
        ]
    return [
        BookingExtraContract(id="extra_laundry", title="Laundry", price=20.0, isAvailable=True),
    ]


async def _build_cleaner_card(cleaner) -> CleanerCardContract:
    reviews = await retrieve_reviews(filters={"cleaner_id": str(cleaner.id)}, start=0, stop=200)
    ratings = [review.stars for review in reviews]
    average_rating = (sum(ratings) / len(ratings)) if ratings else 4.8
    total_reviews = len(ratings)

    return CleanerCardContract(
        id=str(cleaner.id),
        name=_display_name(cleaner.firstName, cleaner.lastName),
        rating=round(float(average_rating), 1),
        jobsDone=max(total_reviews * 5, 40),
        hourlyRate=38.0,
        isVerified=True,
        avatarUrl=None,
        roleLabel="Professional Cleaner",
        yearsExperience=5,
        bookingsCount=max(total_reviews * 10, 120),
        heroImageUrl=None,
    )


async def list_contract_cleaners(filters: CleanerFiltersContract) -> list[CleanerCardContract]:
    cleaners = await retrieve_cleaners(start=0, stop=100)

    semaphore = asyncio.Semaphore(8)

    async def _build(cleaner):
        async with semaphore:
            return await _build_cleaner_card(cleaner)

    cards = await asyncio.gather(*[_build(cleaner) for cleaner in cleaners]) if cleaners else []

    filtered = cards
    if filters.minRating is not None:
        filtered = [item for item in filtered if item.rating >= filters.minRating]
    if filters.maxHourlyRate is not None:
        filtered = [item for item in filtered if item.hourlyRate <= filters.maxHourlyRate]
    if filters.onlyAvailableNow:
        filtered = [item for item in filtered if item.isVerified]

    return filtered


async def get_cleaner_profile_contract(cleaner_id: str) -> CleanerProfileContract:
    cleaner = await retrieve_cleaner_by_id(id=cleaner_id)
    reviews = await retrieve_reviews(filters={"cleaner_id": cleaner_id}, start=0, stop=6)
    ratings = [review.stars for review in reviews]
    average_rating = (sum(ratings) / len(ratings)) if ratings else 4.8

    preview = [
        CleanerReviewContract(
            id=str(review.id or f"rv_{index}"),
            reviewerName="Customer",
            rating=review.stars,
            text=review.comment,
            timestamp=_epoch_to_datetime(review.date_created),
            avatarUrl=None,
        )
        for index, review in enumerate(reviews)
    ]

    if not preview:
        preview = [
            CleanerReviewContract(
                id="rv_demo",
                reviewerName="Marcus L.",
                rating=5,
                text="Excellent service and attention to detail.",
                timestamp=_utc_now(),
                avatarUrl=None,
            )
        ]

    return CleanerProfileContract(
        id=cleaner_id,
        name=_display_name(cleaner.firstName, cleaner.lastName),
        yearsExperience=5,
        roleLabel="Professional Cleaner",
        heroImageUrl=None,
        rating=round(float(average_rating), 1),
        reviewsCount=len(reviews),
        bookingsCount=max(len(reviews) * 10, 120),
        hourlyRate=38.0,
        certifications=[
            CleanerCertificationContract(
                id="cert_bg",
                label="Background Checked",
                icon="verified_user_outlined",
            )
        ],
        about="Reliable cleaning professional with strong customer satisfaction.",
        reviewPreview=preview,
    )


def _apply_time_period_filter(items: list, time_period: str) -> list:
    if time_period == "all":
        return items

    now = _utc_now()
    if time_period == "last30Days":
        min_time = now - timedelta(days=30)
    elif time_period == "last90Days":
        min_time = now - timedelta(days=90)
    else:
        min_time = now - timedelta(days=365)

    filtered = []
    for item in items:
        item_time = _epoch_to_datetime(item.date_created)
        if item_time >= min_time:
            filtered.append(item)
    return filtered


async def list_cleaner_reviews_contract(cleaner_id: str, filters: CleanerReviewFiltersContract) -> CleanerReviewsPageContract:
    offset = int(filters.cursor) if filters.cursor and filters.cursor.isdigit() else 0
    stop = offset + max(filters.pageSize * 4, filters.pageSize)
    reviews = await retrieve_reviews(filters={"cleaner_id": cleaner_id}, start=offset, stop=stop)

    filtered_reviews = _apply_time_period_filter(reviews, filters.timePeriod.value)
    if filters.stars is not None:
        filtered_reviews = [item for item in filtered_reviews if item.stars == filters.stars]

    selected = filtered_reviews[: filters.pageSize]
    next_cursor = str(offset + filters.pageSize) if len(filtered_reviews) > filters.pageSize else None

    items = [
        CleanerReviewContract(
            id=str(review.id or f"rv_{index}"),
            reviewerName="Customer",
            rating=review.stars,
            text=review.comment,
            timestamp=_epoch_to_datetime(review.date_created),
            avatarUrl=None,
        )
        for index, review in enumerate(selected)
    ]

    return CleanerReviewsPageContract(items=items, nextCursor=next_cursor)


async def create_booking_contract(
    *,
    principal: AuthPrincipal,
    payload: BookingCreateRequestContract,
) -> BookingCreateResponseContract:
    selected_add_ons = [
        value for value in (_map_addon(extra_id) for extra_id in payload.selectedExtraIds) if value is not None
    ]

    booking_payload = BookingBase(
        customer_id=principal.user_id,
        place_id=payload.location.id,
        cleaner_id=payload.cleaner.id,
        schedule=int(payload.schedule.date.timestamp()),
        extras=Extra(add_ons=selected_add_ons),
        service=_map_service(payload.service.id),
        duration=Duration(hours=payload.duration.hours, minutes=payload.duration.minutes),
        custom_details=None,
    )

    booking = await create_booking_for_customer(principal=principal, payload=booking_payload)
    if not booking.id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Booking creation failed", "code": "INTERNAL_ERROR"},
        )

    return BookingCreateResponseContract(bookingId=booking.id)


async def fetch_customer_home_page(principal: AuthPrincipal) -> HomePayloadContract:
    customer = await retrieve_user_by_user_id(id=principal.user_id)

    locations = []
    selected_location = None

    try:
        saved_addresses = await list_my_saved_addresses(user_id=principal.user_id, start=0, stop=5)
        for address in saved_addresses:
            place = address.place.model_dump() if address.place else {}
            item = {
                "id": str(address.id or place.get("place_id") or "loc_unknown"),
                "label": address.label or place.get("name") or "Saved place",
                "addressLine": address.addressLine or place.get("formatted_address") or place.get("description") or "Address",
                "hint": "Default" if address.isDefault else "Saved",
            }
            locations.append(item)
            if address.isDefault and selected_location is None:
                selected_location = item
        if locations and selected_location is None:
            selected_location = locations[0]
    except Exception:
        locations = []

    unread_count = 0
    try:
        unread_count = await db.notificationss.count_documents({"isRead": False})
    except Exception:
        unread_count = 0

    return HomePayloadContract(
        user={
            "firstName": customer.firstName or "",
            "greetingEyebrow": "Welcome back",
        },
        header={
            "notification": {
                "unreadCount": unread_count,
                "enabled": True,
                "action": {
                    "type": "route",
                    "value": "/notifications",
                    "label": None,
                },
            }
        },
        location={
            "selected": selected_location,
            "locations": locations,
            "action": {
                "type": "bottom_sheet",
                "value": "location_picker",
                "label": None,
            },
            "isLoading": False,
            "enabled": True,
        },
        sections=[],
        nav={
            "currentIndex": 0,
            "items": [],
        },
    )


async def list_notifications_contract(*, page: int, page_size: int) -> list[NotificationItemContract]:
    start = page * page_size
    stop = start + page_size

    items: list[NotificationItemContract] = []

    try:
        cursor = db.notificationss.find({}).skip(start).limit(stop - start)
        async for doc in cursor:
            raw_type = str(doc.get("type") or "service_update").lower()
            allowed_types = {value.value for value in NotificationTypeContract}
            item_type = raw_type if raw_type in allowed_types else "service_update"
            items.append(
                NotificationItemContract(
                    id=str(doc.get("_id") or ""),
                    type=item_type, # type: ignore
                    title=str(doc.get("title") or "Notification"),
                    message=str(doc.get("message") or ""),
                    timestamp=_epoch_to_datetime(doc.get("date_created") or doc.get("last_updated")),
                    isRead=bool(doc.get("isRead", False)),
                    action={"type": "route", "value": "/notifications", "label": None}, # type: ignore
                )
            )
    except Exception:
        items = []

    if items:
        return items

    return [
        NotificationItemContract(
            id="ntf_1",
            type="service_update", # type: ignore
            title="Cleaner is on the way",
            message="Arrives in 10 minutes",
            timestamp=_utc_now(),
            isRead=False,
            action={"type": "route", "value": "/booking/tracking/BK-123", "label": None}, # type: ignore
        )
    ]


async def mark_notification_as_read_contract(notification_id: str) -> None:
    if not ObjectId.is_valid(notification_id):
        return None
    try:
        await db.notificationss.update_one({"_id": ObjectId(notification_id)}, {"$set": {"isRead": True}})
    except Exception:
        return None


async def mark_all_notifications_as_read_contract() -> None:
    try:
        await db.notificationss.update_many({}, {"$set": {"isRead": True}})
    except Exception:
        return None


async def delete_notification_contract(notification_id: str) -> None:
    if not ObjectId.is_valid(notification_id):
        return None
    try:
        await db.notificationss.delete_one({"_id": ObjectId(notification_id)})
    except Exception:
        return None
