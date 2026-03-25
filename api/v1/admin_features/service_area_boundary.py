from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.service_area_boundary import ServiceAreaBoundaryBase, ServiceAreaBoundaryCreate, ServiceAreaBoundaryUpdate
from services.service_area_boundary_service import (
    add_service_area_boundary,
    remove_service_area_boundary,
    retrieve_service_area_boundary_by_id,
    retrieve_service_area_boundarys,
    update_service_area_boundary_by_id,
)

router = APIRouter(prefix="/service-areas", tags=["Admin Service Areas"])


@router.get("/")
@document_response(message="ServiceAreaBoundary list fetched successfully", success_example=[])
async def list_service_area_boundarys(
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
    return await retrieve_service_area_boundarys(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ServiceAreaBoundary fetched successfully")
async def get_service_area_boundary(id: str = Path(..., description="Resource identifier")):
    return await retrieve_service_area_boundary_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ServiceAreaBoundary created successfully", status_code=status.HTTP_201_CREATED)
async def create_service_area_boundary(payload: ServiceAreaBoundaryBase):
    return await add_service_area_boundary(ServiceAreaBoundaryCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="ServiceAreaBoundary updated successfully")
async def patch_service_area_boundary(id: str, payload: ServiceAreaBoundaryUpdate):
    return await update_service_area_boundary_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="ServiceAreaBoundary deleted successfully")
async def delete_service_area_boundary(id: str):
    await remove_service_area_boundary(id=id)
    return None
