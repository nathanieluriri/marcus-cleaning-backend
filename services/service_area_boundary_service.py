from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.service_area_boundary import create_service_area_boundary, delete_service_area_boundary, get_service_area_boundary, get_service_area_boundarys, update_service_area_boundary
from schemas.service_area_boundary import ServiceAreaBoundaryCreate, ServiceAreaBoundaryOut, ServiceAreaBoundaryUpdate


async def add_service_area_boundary(payload: ServiceAreaBoundaryCreate) -> ServiceAreaBoundaryOut:
    return await create_service_area_boundary(payload)


async def retrieve_service_area_boundary_by_id(*, id: str) -> ServiceAreaBoundaryOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_service_area_boundary({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceAreaBoundary not found")
    return result


async def retrieve_service_area_boundarys(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ServiceAreaBoundaryOut]:
    return await get_service_area_boundarys(filter_dict=filters or {}, start=start, stop=stop)


async def update_service_area_boundary_by_id(*, id: str, payload: ServiceAreaBoundaryUpdate) -> ServiceAreaBoundaryOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_service_area_boundary({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceAreaBoundary not found")
    return result


async def remove_service_area_boundary(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_service_area_boundary({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ServiceAreaBoundary not found")
    return True
