from __future__ import annotations

from fastapi import HTTPException, status

from schemas.booking import BookingCustomerCreateRequest
from schemas.customer_app_contract import BookingCreateRequestContract
from schemas.imports import AddOn, CleaningServices, Duration, Extra


def map_addon(extra_id: str) -> AddOn | None:
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


def map_service(service_id: str) -> CleaningServices:
    normalized = service_id.lower()
    if "deep" in normalized:
        return CleaningServices.DEEP_CLEAN
    if "office" in normalized:
        return CleaningServices.OFFICE
    if "custom" in normalized:
        return CleaningServices.CUSTOM
    return CleaningServices.STANDARD


def build_booking_base_from_contract(
    *,
    payload: BookingCreateRequestContract,
) -> BookingCustomerCreateRequest:
    selected_add_ons = [
        value for value in (map_addon(extra_id) for extra_id in payload.selectedExtraIds) if value is not None
    ]

    return BookingCustomerCreateRequest(
        place_id=payload.location.id,
        cleaner_id=payload.cleaner.id,
        schedule=int(payload.schedule.date.timestamp()),
        extras=Extra(add_ons=selected_add_ons),
        service=map_service(payload.service.id),
        duration=Duration(hours=payload.duration.hours, minutes=payload.duration.minutes),
        custom_details=None,
    )


def validate_selected_extras_against_available(
    *,
    selected_extra_ids: list[str],
    available_extra_ids: set[str],
) -> None:
    if len(selected_extra_ids) != len(set(selected_extra_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="selectedExtraIds cannot contain duplicates",
        )

    invalid_ids = [extra_id for extra_id in selected_extra_ids if extra_id not in available_extra_ids]
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "message": "selectedExtraIds must exist in availableExtras",
                "invalidExtraIds": sorted(set(invalid_ids)),
            },
        )
