from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.service_area_boundary import ServiceAreaBoundaryCreate, ServiceAreaBoundaryOut, ServiceAreaBoundaryUpdate


def _collection():
    return db.service_area_boundaries


async def create_service_area_boundary(payload: ServiceAreaBoundaryCreate) -> ServiceAreaBoundaryOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return ServiceAreaBoundaryOut(**row)


async def get_service_area_boundary(filter_dict: dict) -> Optional[ServiceAreaBoundaryOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return ServiceAreaBoundaryOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch service_area_boundary: {err}") from err


async def get_service_area_boundarys(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[ServiceAreaBoundaryOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[ServiceAreaBoundaryOut] = []
    async for row in cursor:
        items.append(ServiceAreaBoundaryOut(**row))
    return items


async def update_service_area_boundary(filter_dict: dict, payload: ServiceAreaBoundaryUpdate) -> ServiceAreaBoundaryOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return ServiceAreaBoundaryOut(**row)


async def delete_service_area_boundary(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
