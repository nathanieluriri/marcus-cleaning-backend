from __future__ import annotations

import time

from fastapi import status

from core.errors import AppException, ErrorCode, auth_role_mismatch, resource_not_found
from repositories.booking_repo import (
    create_booking,
    delete_booking,
    get_booking_by_id,
    get_bookings,
    transition_booking_status,
    update_booking_fields,
)
from schemas.booking import BookingBase, BookingCreate, BookingOut
from schemas.imports import BookingStatus
from security.principal import AuthPrincipal
from services.cleaner_service import retrieve_user_by_user_id as retrieve_cleaner_by_id
from services.customer_service import retrieve_user_by_user_id as retrieve_customer_by_id
from services.payment_service import create_payment_for_booking, get_payment_transaction
from services.pricing_service import calculate_quote_for_booking_id


def _epoch() -> int:
    return int(time.time())


def _status_conflict(*, current_status: BookingStatus, expected_status: BookingStatus) -> AppException:
    return AppException(
        status_code=status.HTTP_409_CONFLICT,
        code=ErrorCode.VALIDATION_FAILED,
        message="Invalid booking status transition",
        details={
            "current_status": current_status.value,
            "expected_status": expected_status.value,
        },
    )


async def create_booking_for_customer(*, principal: AuthPrincipal, payload: BookingBase) -> BookingOut:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)
    if payload.customer_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="customer_id must match authenticated user",
        )

    await retrieve_customer_by_id(id=payload.customer_id)
    await retrieve_cleaner_by_id(id=payload.cleaner_id)

    booking = await create_booking(
        BookingCreate(
            **payload.model_dump(),
            status=BookingStatus.REQUESTED,
        )
    )

    booking_id = booking.id
    if not booking_id:
        raise AppException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            message="Created booking has no identifier",
        )

    try:
        payment_tx = await create_payment_for_booking(booking_id=booking_id)
        quote = await calculate_quote_for_booking_id(booking_id=booking_id)
    except Exception:
        await delete_booking(booking_id=booking_id)
        raise

    updated = await update_booking_fields(
        booking_id=booking_id,
        update_dict={
            "payment_id": payment_tx.id,
            "price_amount_minor": quote.amount_minor,
            "price_currency": quote.currency,
            "price_breakdown": quote.breakdown,
            "last_updated": _epoch(),
        },
    )
    if updated is None:
        raise AppException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            message="Failed to attach payment to booking",
            details={"booking_id": booking_id},
        )
    return updated


async def retrieve_booking_by_id(*, booking_id: str) -> BookingOut:
    booking = await get_booking_by_id(booking_id)
    if booking is None:
        raise resource_not_found("Booking", booking_id)
    return booking


async def retrieve_booking_for_principal(*, booking_id: str, principal: AuthPrincipal) -> BookingOut:
    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if principal.role == "admin":
        return booking
    if principal.role == "customer" and booking.customer_id == principal.user_id:
        return booking
    if principal.role == "cleaner" and booking.cleaner_id == principal.user_id:
        return booking
    raise AppException(
        status_code=status.HTTP_403_FORBIDDEN,
        code=ErrorCode.AUTH_PERMISSION_DENIED,
        message="You do not have access to this booking",
    )


async def retrieve_bookings_for_principal(
    *,
    principal: AuthPrincipal,
    start: int = 0,
    stop: int = 100,
    status_filter: BookingStatus | None = None,
) -> list[BookingOut]:
    filter_dict: dict = {}
    if principal.role == "customer":
        filter_dict["customer_id"] = principal.user_id
    elif principal.role == "cleaner":
        filter_dict["cleaner_id"] = principal.user_id
    elif principal.role != "admin":
        raise auth_role_mismatch(required_role="cleaner|customer|admin", actual_role=principal.role)

    if status_filter is not None:
        filter_dict["status"] = status_filter.value

    return await get_bookings(filter_dict=filter_dict, start=start, stop=stop)


async def accept_booking(
    *,
    booking_id: str,
    principal: AuthPrincipal,
    allow_pending_payment: bool,
) -> BookingOut:
    if principal.role != "cleaner":
        raise auth_role_mismatch(required_role="cleaner", actual_role=principal.role)

    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if booking.cleaner_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="Only the assigned cleaner can accept this booking",
        )
    if booking.status != BookingStatus.REQUESTED:
        raise _status_conflict(current_status=booking.status, expected_status=BookingStatus.REQUESTED)
    if booking.cleaner_acceptance_deadline and _epoch() > booking.cleaner_acceptance_deadline:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Cleaner acceptance deadline has passed",
            details={"cleaner_acceptance_deadline": booking.cleaner_acceptance_deadline},
        )

    if not allow_pending_payment:
        if not booking.payment_id:
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code=ErrorCode.VALIDATION_FAILED,
                message="Booking payment is required before acceptance",
            )
        tx = await get_payment_transaction(payment_id=booking.payment_id)
        if tx.status.lower() != "succeeded":
            raise AppException(
                status_code=status.HTTP_409_CONFLICT,
                code=ErrorCode.VALIDATION_FAILED,
                message="Booking payment must be successful before acceptance",
                details={"payment_status": tx.status},
            )

    updated = await transition_booking_status(
        booking_id=booking_id,
        expected_status=BookingStatus.REQUESTED.value,
        update_dict={
            "status": BookingStatus.ACCEPTED.value,
            "cleaner_accepted_at": _epoch(),
            "last_updated": _epoch(),
        },
    )
    if updated is None:
        latest = await retrieve_booking_by_id(booking_id=booking_id)
        raise _status_conflict(current_status=latest.status, expected_status=BookingStatus.REQUESTED)
    return updated


async def complete_booking(*, booking_id: str, principal: AuthPrincipal) -> BookingOut:
    if principal.role != "cleaner":
        raise auth_role_mismatch(required_role="cleaner", actual_role=principal.role)

    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if booking.cleaner_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="Only the assigned cleaner can complete this booking",
        )
    if booking.status != BookingStatus.ACCEPTED:
        raise _status_conflict(current_status=booking.status, expected_status=BookingStatus.ACCEPTED)

    updated = await transition_booking_status(
        booking_id=booking_id,
        expected_status=BookingStatus.ACCEPTED.value,
        update_dict={
            "status": BookingStatus.CLEANER_COMPLETED.value,
            "cleaner_completed_at": _epoch(),
            "last_updated": _epoch(),
        },
    )
    if updated is None:
        latest = await retrieve_booking_by_id(booking_id=booking_id)
        raise _status_conflict(current_status=latest.status, expected_status=BookingStatus.ACCEPTED)
    return updated


async def acknowledge_booking_completion(*, booking_id: str, principal: AuthPrincipal) -> BookingOut:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)

    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if booking.customer_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="Only the booking customer can acknowledge completion",
        )
    if booking.status != BookingStatus.CLEANER_COMPLETED:
        raise _status_conflict(current_status=booking.status, expected_status=BookingStatus.CLEANER_COMPLETED)

    updated = await transition_booking_status(
        booking_id=booking_id,
        expected_status=BookingStatus.CLEANER_COMPLETED.value,
        update_dict={
            "status": BookingStatus.CUSTOMER_ACKNOWLEDGED.value,
            "customer_acknowledged_at": _epoch(),
            "last_updated": _epoch(),
        },
    )
    if updated is None:
        latest = await retrieve_booking_by_id(booking_id=booking_id)
        raise _status_conflict(current_status=latest.status, expected_status=BookingStatus.CLEANER_COMPLETED)
    return updated
