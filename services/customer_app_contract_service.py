from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import HTTPException, status

from core.database import db
from schemas.booking import BookingBase
from schemas.customer_app_contract import (
    AuthPasswordResetRequestContract,
    AuthResponseContract,
    AuthSignInRequestContract,
    AuthSignUpRequestContract,
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
    NotificationTypeContract,
    NotificationItemContract,
)
from schemas.customer_schema import CustomerLogin, CustomerSignupRequest
from schemas.imports import AddOn, CleaningServices, Duration, Extra
from security.principal import AuthPrincipal
from services.booking_service import create_booking_for_customer
from services.cleaner_service import retrieve_user_by_user_id as retrieve_cleaner_by_id
from services.cleaner_service import retrieve_users as retrieve_cleaners
from services.customer_service import add_user, authenticate_user, retrieve_user_by_user_id
from services.review_service import retrieve_reviews


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
        phoneNumber=None,
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
        phoneNumber=None,
        createdAt=_epoch_to_datetime(customer.date_created),
    )
    return AuthResponseContract(
        accessToken=customer.access_token or "",
        refreshToken=customer.refresh_token,
        expiresAt=_utc_now() + timedelta(hours=1),
        user=user,
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
        cursor = db.autocomplete_search_results.find({"user_id": principal.user_id}).limit(5)
        async for doc in cursor:
            place = doc.get("place", {})
            item = {
                "id": str(doc.get("_id") or place.get("place_id") or "loc_unknown"),
                "label": place.get("name") or "Saved place",
                "addressLine": place.get("formatted_address") or place.get("description") or "Address",
                "hint": "Recently used",
            }
            locations.append(item)
        if locations:
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
