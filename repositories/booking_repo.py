from __future__ import annotations

from bson import ObjectId
from pymongo import ReturnDocument

from core.database import db
from schemas.booking import BookingCreate, BookingOut

_BOOKING_INDEXES_READY = False


async def _ensure_booking_indexes() -> None:
    global _BOOKING_INDEXES_READY
    if _BOOKING_INDEXES_READY:
        return

    await db.bookings.create_index("customer_id", name="idx_booking_customer_id")
    await db.bookings.create_index("cleaner_id", name="idx_booking_cleaner_id")
    await db.bookings.create_index("status", name="idx_booking_status")
    await db.bookings.create_index("place_id", name="idx_booking_place_id")
    await db.bookings.create_index(
        "payment_id",
        name="idx_booking_payment_id_unique",
        unique=True,
        sparse=True,
    )
    _BOOKING_INDEXES_READY = True


def _id_filter(booking_id: str) -> dict:
    if ObjectId.is_valid(booking_id):
        return {"_id": ObjectId(booking_id)}
    return {"_id": booking_id}


async def create_booking(payload: BookingCreate) -> BookingOut:
    await _ensure_booking_indexes()
    result = await db.bookings.insert_one(payload.model_dump(mode="json"))
    stored = await db.bookings.find_one({"_id": result.inserted_id})
    return BookingOut(**stored) # type: ignore


async def get_booking_by_id(booking_id: str) -> BookingOut | None:
    await _ensure_booking_indexes()
    row = await db.bookings.find_one(_id_filter(booking_id))
    if row is None:
        return None
    return BookingOut(**row)


async def get_bookings(
    *,
    filter_dict: dict | None = None,
    start: int = 0,
    stop: int = 100,
) -> list[BookingOut]:
    await _ensure_booking_indexes()
    query = filter_dict or {}
    cursor = db.bookings.find(query).skip(start).limit(max(0, stop - start))
    items: list[BookingOut] = []
    async for row in cursor:
        items.append(BookingOut(**row))
    return items


async def update_booking_fields(booking_id: str, update_dict: dict) -> BookingOut | None:
    await _ensure_booking_indexes()
    if not update_dict:
        return await get_booking_by_id(booking_id)
    row = await db.bookings.find_one_and_update(
        _id_filter(booking_id),
        {"$set": update_dict},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return BookingOut(**row)


async def transition_booking_status(
    *,
    booking_id: str,
    expected_status: str,
    update_dict: dict,
) -> BookingOut | None:
    await _ensure_booking_indexes()
    row = await db.bookings.find_one_and_update(
        {**_id_filter(booking_id), "status": expected_status},
        {"$set": update_dict},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return BookingOut(**row)


async def delete_booking(booking_id: str):
    await _ensure_booking_indexes()
    return await db.bookings.delete_one(_id_filter(booking_id))
