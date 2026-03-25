from __future__ import annotations

from fastapi import HTTPException, status

from schemas.imports import BookingStatus

_ALLOWED_BOOKING_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.REQUESTED: {BookingStatus.ACCEPTED, BookingStatus.CANCELLED},
    BookingStatus.ACCEPTED: {BookingStatus.CLEANER_COMPLETED, BookingStatus.CANCELLED},
    BookingStatus.CLEANER_COMPLETED: {BookingStatus.CUSTOMER_ACKNOWLEDGED},
    BookingStatus.CUSTOMER_ACKNOWLEDGED: set(),
    BookingStatus.CANCELLED: set(),
}

_ALLOWED_CONCIERGE_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.REQUESTED: {BookingStatus.ACCEPTED, BookingStatus.CANCELLED},
    BookingStatus.ACCEPTED: {BookingStatus.CLEANER_COMPLETED, BookingStatus.CANCELLED},
    BookingStatus.CLEANER_COMPLETED: {BookingStatus.CUSTOMER_ACKNOWLEDGED},
    BookingStatus.CUSTOMER_ACKNOWLEDGED: set(),
    BookingStatus.CANCELLED: set(),
}


def assert_booking_transition(*, current: BookingStatus, target: BookingStatus) -> None:
    if target in _ALLOWED_BOOKING_TRANSITIONS.get(current, set()):
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "Invalid booking status transition",
            "code": "INVALID_BOOKING_STATUS_TRANSITION",
            "details": {"current_status": current.value, "target_status": target.value},
        },
    )


def assert_concierge_transition(*, current: BookingStatus, target: BookingStatus) -> None:
    if target in _ALLOWED_CONCIERGE_TRANSITIONS.get(current, set()):
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "Invalid concierge status transition",
            "code": "INVALID_CONCIERGE_STATUS_TRANSITION",
            "details": {"current_status": current.value, "target_status": target.value},
        },
    )

