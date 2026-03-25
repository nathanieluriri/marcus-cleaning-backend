from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.admin_schema import AdminOut
from schemas.concierge_booking import (
    AdminConciergeCreateBookingRequest,
    ConciergeBookingCreateRequest,
    ConciergeBookingUpdateRequest,
)
from security.account_status_check import check_admin_account_status_and_permissions
from services.concierge_booking_service import (
    add_concierge_booking,
    create_concierge_booking_for_admin,
    remove_concierge_booking,
    retrieve_concierge_booking_by_id,
    retrieve_concierge_bookings,
    update_concierge_booking_by_id,
)

router = APIRouter(prefix="/concierge-bookings", tags=["Admin Concierge Bookings"])


@router.get("/")
@document_response(message="ConciergeBooking list fetched successfully", success_example=[])
async def list_concierge_bookings(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=100, gt=0, le=500),
    filters: str | None = Query(default=None),
):
    parsed_filters: dict = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filters JSON") from err
    return await retrieve_concierge_bookings(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ConciergeBooking fetched successfully")
async def get_concierge_booking(id: str = Path(..., description="Resource identifier")):
    return await retrieve_concierge_booking_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ConciergeBooking created successfully", status_code=status.HTTP_201_CREATED)
async def create_concierge_booking(
    payload: ConciergeBookingCreateRequest,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await add_concierge_booking(
        payload=payload,
        admin_id=admin.id or "",
    )


@router.post("/create-booking", status_code=status.HTTP_201_CREATED)
@document_response(message="Concierge booking created successfully", status_code=status.HTTP_201_CREATED)
async def create_booking_on_behalf(
    payload: AdminConciergeCreateBookingRequest,
    note: str | None = Query(default=None),
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    booking, concierge_record = await create_concierge_booking_for_admin(
        admin_id=admin.id or "",
        payload=payload,
        note=note,
    )
    return {"booking": booking, "concierge_record": concierge_record}


@router.patch("/{id}")
@document_response(message="ConciergeBooking updated successfully")
async def patch_concierge_booking(id: str, payload: ConciergeBookingUpdateRequest):
    return await update_concierge_booking_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="ConciergeBooking deleted successfully")
async def delete_concierge_booking(id: str):
    await remove_concierge_booking(id=id)
    return None
