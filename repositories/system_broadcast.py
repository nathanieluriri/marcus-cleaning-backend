from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.system_broadcast import SystemBroadcastCreate, SystemBroadcastOut, SystemBroadcastUpdate


def _collection():
    return db.system_broadcasts


async def create_system_broadcast(payload: SystemBroadcastCreate) -> SystemBroadcastOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return SystemBroadcastOut(**row)


async def get_system_broadcast(filter_dict: dict) -> Optional[SystemBroadcastOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return SystemBroadcastOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch system_broadcast: {err}") from err


async def get_system_broadcasts(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[SystemBroadcastOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[SystemBroadcastOut] = []
    async for row in cursor:
        items.append(SystemBroadcastOut(**row))
    return items


async def update_system_broadcast(filter_dict: dict, payload: SystemBroadcastUpdate) -> SystemBroadcastOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return SystemBroadcastOut(**row)


async def delete_system_broadcast(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
