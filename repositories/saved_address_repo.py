from __future__ import annotations

from typing import Any

from bson import ObjectId
from pymongo import DESCENDING, ReturnDocument

from core.database import db
from schemas.saved_address import SavedAddressCreate, SavedAddressOut, SavedAddressUpdate

_SAVED_ADDRESS_INDEXES_READY = False


async def _ensure_saved_address_indexes() -> None:
    global _SAVED_ADDRESS_INDEXES_READY
    if _SAVED_ADDRESS_INDEXES_READY:
        return
    await db.saved_addresses.create_index("user_id", name="idx_saved_addresses_user_id")
    await db.saved_addresses.create_index(
        [("user_id", 1), ("isDefault", 1)],
        name="idx_saved_addresses_user_default_unique",
        unique=True,
        partialFilterExpression={"isDefault": True},
    )
    await db.saved_addresses.create_index(
        [("user_id", 1), ("last_updated", -1)],
        name="idx_saved_addresses_user_last_updated",
    )
    _SAVED_ADDRESS_INDEXES_READY = True


def _id_filters(address_id: str) -> list[dict[str, Any]]:
    filters: list[dict[str, Any]] = []
    if ObjectId.is_valid(address_id):
        filters.append({"_id": ObjectId(address_id)})
    filters.append({"_id": address_id})
    filters.append({"id": address_id})
    return filters


async def create_saved_address(payload: SavedAddressCreate) -> SavedAddressOut:
    await _ensure_saved_address_indexes()
    result = await db.saved_addresses.insert_one(payload.model_dump(mode="json"))
    stored = await db.saved_addresses.find_one({"_id": result.inserted_id})
    return SavedAddressOut(**stored)  # type: ignore[arg-type]


async def list_saved_addresses_for_user(*, user_id: str, start: int = 0, stop: int = 100) -> list[SavedAddressOut]:
    await _ensure_saved_address_indexes()
    cursor = (
        db.saved_addresses.find({"user_id": user_id})
        .sort([("isDefault", DESCENDING), ("last_updated", DESCENDING), ("date_created", DESCENDING)])
        .skip(start)
        .limit(max(0, stop - start))
    )
    items: list[SavedAddressOut] = []
    async for row in cursor:
        items.append(SavedAddressOut(**row))
    return items


async def get_saved_address_by_id_for_user(*, address_id: str, user_id: str) -> SavedAddressOut | None:
    await _ensure_saved_address_indexes()
    for id_filter in _id_filters(address_id):
        row = await db.saved_addresses.find_one({**id_filter, "user_id": user_id})
        if row is not None:
            return SavedAddressOut(**row)
    return None


async def update_saved_address_for_user(
    *,
    address_id: str,
    user_id: str,
    payload: SavedAddressUpdate,
) -> SavedAddressOut | None:
    await _ensure_saved_address_indexes()
    update_dict = payload.model_dump(exclude_none=True)
    if not update_dict:
        return await get_saved_address_by_id_for_user(address_id=address_id, user_id=user_id)
    for id_filter in _id_filters(address_id):
        row = await db.saved_addresses.find_one_and_update(
            {**id_filter, "user_id": user_id},
            {"$set": update_dict},
            return_document=ReturnDocument.AFTER,
        )
        if row is not None:
            return SavedAddressOut(**row)
    return None


async def delete_saved_address_for_user(*, address_id: str, user_id: str) -> bool:
    await _ensure_saved_address_indexes()
    for id_filter in _id_filters(address_id):
        result = await db.saved_addresses.delete_one({**id_filter, "user_id": user_id})
        if result.deleted_count:
            return True
    return False


async def clear_default_for_user(*, user_id: str) -> None:
    await _ensure_saved_address_indexes()
    await db.saved_addresses.update_many(
        {"user_id": user_id, "isDefault": True},
        {"$set": {"isDefault": False}},
    )


async def mark_saved_address_as_default_for_user(*, address_id: str, user_id: str, last_updated: int) -> SavedAddressOut | None:
    await _ensure_saved_address_indexes()
    for id_filter in _id_filters(address_id):
        row = await db.saved_addresses.find_one_and_update(
            {**id_filter, "user_id": user_id},
            {"$set": {"isDefault": True, "last_updated": last_updated}},
            return_document=ReturnDocument.AFTER,
        )
        if row is not None:
            return SavedAddressOut(**row)
    return None


async def get_most_recent_saved_address_for_user(*, user_id: str) -> SavedAddressOut | None:
    await _ensure_saved_address_indexes()
    row = await db.saved_addresses.find_one(
        {"user_id": user_id},
        sort=[("last_updated", DESCENDING), ("date_created", DESCENDING), ("_id", DESCENDING)],
    )
    if row is None:
        return None
    return SavedAddressOut(**row)
