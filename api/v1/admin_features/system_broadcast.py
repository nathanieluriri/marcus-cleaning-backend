from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.system_broadcast import SystemBroadcastBase, SystemBroadcastCreate, SystemBroadcastUpdate
from services.system_broadcast_service import (
    add_system_broadcast,
    dispatch_system_broadcast,
    remove_system_broadcast,
    retrieve_system_broadcast_by_id,
    retrieve_system_broadcasts,
    update_system_broadcast_by_id,
)

router = APIRouter(prefix="/broadcasts", tags=["Admin Broadcasts"])


@router.get("/")
@document_response(message="SystemBroadcast list fetched successfully", success_example=[])
async def list_system_broadcasts(
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
    return await retrieve_system_broadcasts(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="SystemBroadcast fetched successfully")
async def get_system_broadcast(id: str = Path(..., description="Resource identifier")):
    return await retrieve_system_broadcast_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="SystemBroadcast created successfully", status_code=status.HTTP_201_CREATED)
async def create_system_broadcast(payload: SystemBroadcastBase):
    return await add_system_broadcast(SystemBroadcastCreate(**payload.model_dump()))


@router.post("/dispatch", status_code=status.HTTP_201_CREATED)
@document_response(message="System broadcast queued successfully", status_code=status.HTTP_201_CREATED)
async def queue_system_broadcast(payload: SystemBroadcastBase):
    return await dispatch_system_broadcast(SystemBroadcastCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="SystemBroadcast updated successfully")
async def patch_system_broadcast(id: str, payload: SystemBroadcastUpdate):
    return await update_system_broadcast_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="SystemBroadcast deleted successfully")
async def delete_system_broadcast(id: str):
    await remove_system_broadcast(id=id)
    return None
