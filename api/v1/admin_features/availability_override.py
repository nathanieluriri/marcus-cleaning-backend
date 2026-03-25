from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.availability_override import AvailabilityOverrideBase, AvailabilityOverrideCreate, AvailabilityOverrideUpdate
from services.availability_override_service import (
    add_availability_override,
    remove_availability_override,
    retrieve_availability_override_by_id,
    retrieve_availability_overrides,
    update_availability_override_by_id,
)

router = APIRouter(prefix="/availability-overrides", tags=["Admin Availability Overrides"])


@router.get("/")
@document_response(message="AvailabilityOverride list fetched successfully", success_example=[])
async def list_availability_overrides(
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
    return await retrieve_availability_overrides(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="AvailabilityOverride fetched successfully")
async def get_availability_override(id: str = Path(..., description="Resource identifier")):
    return await retrieve_availability_override_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="AvailabilityOverride created successfully", status_code=status.HTTP_201_CREATED)
async def create_availability_override(payload: AvailabilityOverrideBase):
    return await add_availability_override(AvailabilityOverrideCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="AvailabilityOverride updated successfully")
async def patch_availability_override(id: str, payload: AvailabilityOverrideUpdate):
    return await update_availability_override_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="AvailabilityOverride deleted successfully")
async def delete_availability_override(id: str):
    await remove_availability_override(id=id)
    return None
