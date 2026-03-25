from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import status

from core.errors import AppException, ErrorCode, auth_role_mismatch, resource_not_found
from core.database import db
from repositories.booking_repo import (
    create_booking,
    delete_booking,
    get_booking_by_id,
    get_bookings_history,
    transition_booking_status,
    update_booking_fields,
)
from repositories.payment_repo import update_payment_transaction_status
from schemas.booking import (
    BookingBase,
    BookingCreate,
    BookingCustomerCreateRequest,
    BookingHistoryPage,
    BookingHistoryScheduledSort,
    BookingHistoryScope,
    BookingOut,
    BookingPaymentStatus,
)
from schemas.imports import BookingStatus
from schemas.review import ReviewCreate
from security.principal import AuthPrincipal
from services.cleaner_service import retrieve_user_by_user_id as retrieve_cleaner_by_id
from services.customer_service import retrieve_user_by_user_id as retrieve_customer_by_id
from services.booking_state_machine import assert_booking_transition
from services.payment_service import create_payment_for_booking, get_payment_transaction
from services.pricing_service import calculate_quote_for_booking_id
from services.review_service import add_review


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


def _parse_cursor_offset(*, cursor: str | None) -> int:
    if cursor is None:
        return 0
    if not cursor.isdigit():
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.VALIDATION_FAILED,
            message="cursor must be a non-negative integer string",
        )
    return int(cursor)


def _epoch_to_iso8601(epoch: int | None) -> str:
    if not epoch:
        return datetime.now(timezone.utc).isoformat()
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


async def create_booking_for_customer(*, principal: AuthPrincipal, payload: BookingCustomerCreateRequest) -> BookingOut:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)
    await retrieve_customer_by_id(id=principal.user_id)
    await retrieve_cleaner_by_id(id=payload.cleaner_id)
    booking_payload = BookingBase(customer_id=principal.user_id, **payload.model_dump())
    return await _create_booking_with_payment(payload=booking_payload)


async def create_booking_by_admin_for_customer(*, payload: BookingBase) -> BookingOut:
    await retrieve_customer_by_id(id=payload.customer_id)
    await retrieve_cleaner_by_id(id=payload.cleaner_id)
    return await _create_booking_with_payment(payload=payload)


async def _create_booking_with_payment(*, payload: BookingBase) -> BookingOut:
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
    status_filter: BookingStatus | None = None,
    scope: BookingHistoryScope = BookingHistoryScope.ALL,
    payment_status: BookingPaymentStatus | None = None,
    cursor: str | None = None,
    page_size: int = 20,
    scheduled_sort: BookingHistoryScheduledSort = BookingHistoryScheduledSort.DESC,
) -> BookingHistoryPage:
    filter_dict: dict[str, str] = {}
    if principal.role == "customer":
        filter_dict["customer_id"] = principal.user_id
    elif principal.role == "cleaner":
        filter_dict["cleaner_id"] = principal.user_id
    elif principal.role != "admin":
        raise auth_role_mismatch(required_role="cleaner|customer|admin", actual_role=principal.role)

    if status_filter is not None:
        filter_dict["status"] = status_filter.value

    offset = _parse_cursor_offset(cursor=cursor)
    fetched = await get_bookings_history(
        filter_dict=filter_dict,
        scope=scope.value,
        now_epoch=_epoch(),
        payment_status=payment_status.value if payment_status is not None else None,
        cursor_offset=offset,
        page_size=page_size,
        scheduled_sort=scheduled_sort.value,
    )
    has_more = len(fetched) > page_size
    items = fetched[:page_size]
    next_cursor = str(offset + page_size) if has_more else None
    return BookingHistoryPage(items=items, nextCursor=next_cursor)


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
    assert_booking_transition(current=booking.status, target=BookingStatus.ACCEPTED)
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
    assert_booking_transition(current=booking.status, target=BookingStatus.CLEANER_COMPLETED)

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
    assert_booking_transition(current=booking.status, target=BookingStatus.CUSTOMER_ACKNOWLEDGED)

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


async def mark_booking_paid_by_customer(*, booking_id: str, principal: AuthPrincipal) -> dict[str, str]:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)

    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if booking.customer_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="Only the booking customer can mark payment as paid",
        )
    if not booking.payment_id:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Booking has no payment transaction",
        )

    tx = await get_payment_transaction(payment_id=booking.payment_id)
    current_status = (tx.status or "").lower()
    if current_status in {"succeeded", "paid"}:
        return {
            "id": booking_id,
            "paymentStatus": "paid",
            "updatedAt": _epoch_to_iso8601(tx.updated_at),
        }

    if current_status not in {"pending", "failed"}:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Payment cannot be marked as paid in current state",
            details={"payment_status": tx.status},
        )

    updated_tx = await update_payment_transaction_status(
        reference=tx.reference,
        status="succeeded",
        response_payload=dict(tx.response_payload or {}),
    )
    if updated_tx is None:
        raise resource_not_found("PaymentTransaction", tx.reference)

    return {
        "id": booking_id,
        "paymentStatus": "paid",
        "updatedAt": _epoch_to_iso8601(updated_tx.updated_at),
    }


async def rate_booking_by_customer(
    *,
    booking_id: str,
    principal: AuthPrincipal,
    rating: int,
    comment: str,
) -> dict[str, str | int | bool]:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)

    booking = await retrieve_booking_by_id(booking_id=booking_id)
    if booking.customer_id != principal.user_id:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="Only the booking customer can rate this booking",
        )

    if booking.status not in {BookingStatus.CLEANER_COMPLETED, BookingStatus.CUSTOMER_ACKNOWLEDGED}:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Booking cannot be rated in current status",
            details={"status": booking.status.value},
        )

    normalized_comment = comment.strip()
    if rating < 1 or rating > 5:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="rating must be between 1 and 5",
        )
    if len(normalized_comment) < 10:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="comment must contain at least 10 non-space characters",
        )

    existing = await db.reviews.find_one(
        {
            "customer_id": principal.user_id,
            "booking_id": booking_id,
        }
    )
    if existing is not None:
        raise AppException(
            status_code=status.HTTP_409_CONFLICT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Booking has already been rated",
        )

    created = await add_review(
        ReviewCreate(
            customer_id=principal.user_id,
            booking_id=booking_id,
            cleaner_id=booking.cleaner_id,
            comment=normalized_comment,
            stars=rating,
        )
    )
    return {
        "id": booking_id,
        "isRated": True,
        "customerRating": created.stars,
        "customerComment": created.comment,
        "updatedAt": _epoch_to_iso8601(created.last_updated),
    }
