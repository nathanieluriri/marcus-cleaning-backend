from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.concierge_booking import create_concierge_booking, delete_concierge_booking, get_concierge_booking, get_concierge_bookings, update_concierge_booking
from schemas.concierge_booking import AdminConciergeCreateBookingRequest
from schemas.concierge_booking import (
    ConciergeBookingCreate,
    ConciergeBookingCreateRequest,
    ConciergeBookingOut,
    ConciergeBookingUpdate,
    ConciergeBookingUpdateRequest,
)
from schemas.booking import BookingBase, BookingOut
from schemas.imports import BookingStatus
from services.booking_state_machine import assert_concierge_transition
from services.booking_service import create_booking_by_admin_for_customer
from services.cleaner_service import retrieve_user_by_user_id as retrieve_cleaner_by_id


async def add_concierge_booking(*, payload: ConciergeBookingCreateRequest, admin_id: str) -> ConciergeBookingOut:
    return await create_concierge_booking(
        ConciergeBookingCreate(
            admin_id=admin_id,
            customer_id=payload.customer_id,
            booking_id=payload.booking_id,
            note=payload.note,
            status=BookingStatus.REQUESTED,
        )
    )


async def retrieve_concierge_booking_by_id(*, id: str) -> ConciergeBookingOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_concierge_booking({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ConciergeBooking not found")
    return result


async def retrieve_concierge_bookings(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ConciergeBookingOut]:
    return await get_concierge_bookings(filter_dict=filters or {}, start=start, stop=stop)


async def update_concierge_booking_by_id(*, id: str, payload: ConciergeBookingUpdateRequest) -> ConciergeBookingOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    existing = await get_concierge_booking({"_id": ObjectId(id)})
    if existing is None:
        raise HTTPException(status_code=404, detail="ConciergeBooking not found")
    # Status is system-owned; generic admin patch is metadata-only and cannot alter lifecycle state.
    result = await update_concierge_booking(
        {"_id": ObjectId(id)},
        ConciergeBookingUpdate(
            customer_id=payload.customer_id,
            booking_id=payload.booking_id,
            note=payload.note,
        ),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="ConciergeBooking not found")
    return result


async def remove_concierge_booking(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_concierge_booking({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ConciergeBooking not found")
    return True


async def create_concierge_booking_for_admin(
    *,
    admin_id: str,
    payload: AdminConciergeCreateBookingRequest,
    note: str | None = None,
) -> tuple[BookingOut, ConciergeBookingOut]:
    booking_payload = BookingBase(**payload.model_dump())
    cleaner = await retrieve_cleaner_by_id(id=booking_payload.cleaner_id)
    if not bool(getattr(cleaner, "allow_admin_selection", False)):
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Selected cleaner is not available for admin concierge selection",
                "code": "CLEANER_NOT_AVAILABLE_FOR_ADMIN_SELECTION",
                "details": {"cleaner_id": booking_payload.cleaner_id},
            },
        )
    booking = await create_booking_by_admin_for_customer(payload=booking_payload)
    concierge_status = booking.status if getattr(booking, "status", None) else BookingStatus.REQUESTED
    if concierge_status != BookingStatus.REQUESTED:
        assert_concierge_transition(current=BookingStatus.REQUESTED, target=concierge_status)
    concierge_record = await create_concierge_booking(
        ConciergeBookingCreate(
            admin_id=admin_id,
            customer_id=booking_payload.customer_id,
            booking_id=booking.id,
            note=note,
            status=concierge_status,
        )
    )
    return booking, concierge_record
