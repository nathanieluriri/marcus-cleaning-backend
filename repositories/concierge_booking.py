from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.concierge_booking import ConciergeBookingCreate, ConciergeBookingOut, ConciergeBookingUpdate


def _collection():
    return db.concierge_bookings


async def create_concierge_booking(payload: ConciergeBookingCreate) -> ConciergeBookingOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return ConciergeBookingOut(**row)


async def get_concierge_booking(filter_dict: dict) -> Optional[ConciergeBookingOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return ConciergeBookingOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch concierge_booking: {err}") from err


async def get_concierge_bookings(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[ConciergeBookingOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[ConciergeBookingOut] = []
    async for row in cursor:
        items.append(ConciergeBookingOut(**row))
    return items


async def update_concierge_booking(filter_dict: dict, payload: ConciergeBookingUpdate) -> ConciergeBookingOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return ConciergeBookingOut(**row)


async def delete_concierge_booking(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
