from __future__ import annotations

from typing import Any

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING
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
    await db.bookings.create_index("schedule", name="idx_booking_schedule")
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


async def get_bookings_history(
    *,
    filter_dict: dict[str, Any] | None = None,
    scope: str,
    now_epoch: int,
    payment_status: str | None,
    cursor_offset: int,
    page_size: int,
    scheduled_sort: str,
) -> list[BookingOut]:
    await _ensure_booking_indexes()
    query: dict[str, Any] = dict(filter_dict or {})

    if scope in {"upcoming", "current"}:
        query["schedule"] = {"$gte": now_epoch}
    elif scope in {"past", "history"}:
        query["schedule"] = {"$lt": now_epoch}

    direction = ASCENDING if scheduled_sort == "asc" else DESCENDING
    pipeline: list[dict[str, Any]] = [
        {"$match": query},
        {"$addFields": {"_booking_id_str": {"$toString": "$_id"}}},
        {
            "$lookup": {
                "from": "payment_transactions",
                "localField": "_booking_id_str",
                "foreignField": "booking_id",
                "as": "payment_tx",
            }
        },
        {
            "$addFields": {
                "_payment_status_effective": {
                    "$let": {
                        "vars": {"tx": {"$arrayElemAt": ["$payment_tx", 0]}},
                        "in": {"$ifNull": [{"$toLower": "$$tx.status"}, "pending"]},
                    }
                }
            }
        },
    ]
    if payment_status is not None:
        pipeline.append({"$match": {"_payment_status_effective": payment_status}})

    pipeline.extend(
        [
            {"$sort": {"schedule": direction, "_id": direction}},
            {"$skip": cursor_offset},
            {"$limit": page_size + 1},
            {
                "$project": {
                    "_booking_id_str": 0,
                    "payment_tx": 0,
                    "_payment_status_effective": 0,
                }
            },
        ]
    )

    items: list[BookingOut] = []
    cursor = db.bookings.aggregate(pipeline)
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
