from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.availability_override import AvailabilityOverrideCreate, AvailabilityOverrideOut, AvailabilityOverrideUpdate


def _collection():
    return db.availability_overrides


async def create_availability_override(payload: AvailabilityOverrideCreate) -> AvailabilityOverrideOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return AvailabilityOverrideOut(**row)


async def get_availability_override(filter_dict: dict) -> Optional[AvailabilityOverrideOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return AvailabilityOverrideOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch availability_override: {err}") from err


async def get_availability_overrides(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[AvailabilityOverrideOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[AvailabilityOverrideOut] = []
    async for row in cursor:
        items.append(AvailabilityOverrideOut(**row))
    return items


async def update_availability_override(filter_dict: dict, payload: AvailabilityOverrideUpdate) -> AvailabilityOverrideOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return AvailabilityOverrideOut(**row)


async def delete_availability_override(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
