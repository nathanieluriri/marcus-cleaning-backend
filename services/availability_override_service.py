from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.availability_override import create_availability_override, delete_availability_override, get_availability_override, get_availability_overrides, update_availability_override
from schemas.availability_override import AvailabilityOverrideCreate, AvailabilityOverrideOut, AvailabilityOverrideUpdate


async def add_availability_override(payload: AvailabilityOverrideCreate) -> AvailabilityOverrideOut:
    return await create_availability_override(payload)


async def retrieve_availability_override_by_id(*, id: str) -> AvailabilityOverrideOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_availability_override({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="AvailabilityOverride not found")
    return result


async def retrieve_availability_overrides(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[AvailabilityOverrideOut]:
    return await get_availability_overrides(filter_dict=filters or {}, start=start, stop=stop)


async def update_availability_override_by_id(*, id: str, payload: AvailabilityOverrideUpdate) -> AvailabilityOverrideOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_availability_override({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="AvailabilityOverride not found")
    return result


async def remove_availability_override(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_availability_override({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="AvailabilityOverride not found")
    return True
