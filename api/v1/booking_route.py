from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, status

from core.response_envelope import document_response
from core.settings import get_settings
from schemas.booking import BookingBase, BookingOut
from schemas.imports import BookingStatus
from security.auth import verify_any_token
from security.booking_access_check import (
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
@document_response(message="Bookings fetched successfully", success_example=[])
async def list_bookings(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=100, gt=0, le=200),
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await retrieve_bookings_for_principal(
        principal=principal,
        start=start,
        stop=stop,
        status_filter=status_filter,
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
