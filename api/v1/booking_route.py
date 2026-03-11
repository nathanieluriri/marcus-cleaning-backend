from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, status

from core.response_envelope import document_response
from core.settings import get_settings
from schemas.booking import (
    BookingBase,
    BookingHistoryScheduledSort,
    BookingHistoryScope,
    BookingOut,
    BookingPaymentStatus,
)
from schemas.imports import BookingStatus
from security.booking_access_check import (
    require_booking_principal,
    require_booking_visibility,
    require_cleaner_principal,
    require_customer_principal,
)
from security.principal import AuthPrincipal
from services.booking_service import (
    acknowledge_booking_completion,
    accept_booking,
    complete_booking,
    create_booking_for_customer,
    retrieve_bookings_for_principal,
)

router = APIRouter(prefix="/bookings", tags=["Bookings"])


@router.post("/")
@document_response(message="Booking created successfully", status_code=status.HTTP_201_CREATED)
async def create_booking(
    payload: BookingBase,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await create_booking_for_customer(principal=principal, payload=payload)


@router.get("/")
@document_response(message="Bookings fetched successfully", success_example={"items": [], "nextCursor": None})
async def list_bookings(
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    scope: BookingHistoryScope = Query(default=BookingHistoryScope.ALL),
    payment_status: BookingPaymentStatus | None = Query(default=None),
    payment_status_camel: BookingPaymentStatus | None = Query(default=None, alias="paymentStatus"),
    cursor: str | None = Query(default=None),
    page_size: int = Query(default=20, ge=1, le=100),
    page_size_camel: int | None = Query(default=None, alias="pageSize", ge=1, le=100),
    scheduled_sort: BookingHistoryScheduledSort = Query(default=BookingHistoryScheduledSort.DESC),
    scheduled_sort_camel: BookingHistoryScheduledSort | None = Query(default=None, alias="scheduledSort"),
    principal: AuthPrincipal = Depends(require_booking_principal),
):
    effective_payment_status = payment_status_camel or payment_status
    effective_page_size = page_size_camel if page_size_camel is not None else page_size
    effective_scheduled_sort = scheduled_sort_camel or scheduled_sort
    return await retrieve_bookings_for_principal(
        principal=principal,
        status_filter=status_filter,
        scope=scope,
        payment_status=effective_payment_status,
        cursor=cursor,
        page_size=effective_page_size,
        scheduled_sort=effective_scheduled_sort,
    )


@router.get("/{booking_id}")
@document_response(message="Booking fetched successfully")
async def get_booking(
    booking_id: str = Path(..., description="Booking identifier"),
    booking: BookingOut = Depends(require_booking_visibility),
):
    _ = booking_id
    return booking


@router.post("/{booking_id}/accept")
@document_response(message="Booking accepted successfully")
async def accept_booking_request(
    booking_id: str = Path(..., description="Booking identifier"),
    principal: AuthPrincipal = Depends(require_cleaner_principal),
):
    allow_pending = get_settings().booking_allow_accept_on_pending_payment
    return await accept_booking(
        booking_id=booking_id,
        principal=principal,
        allow_pending_payment=allow_pending,
    )


@router.post("/{booking_id}/complete")
@document_response(message="Booking completed successfully")
async def complete_booking_request(
    booking_id: str = Path(..., description="Booking identifier"),
    principal: AuthPrincipal = Depends(require_cleaner_principal),
):
    return await complete_booking(booking_id=booking_id, principal=principal)


@router.post("/{booking_id}/acknowledge")
@document_response(message="Booking completion acknowledged successfully")
async def acknowledge_completion(
    booking_id: str = Path(..., description="Booking identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await acknowledge_booking_completion(booking_id=booking_id, principal=principal)
