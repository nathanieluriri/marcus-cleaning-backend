from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.service_definition import ServiceDefinitionBase, ServiceDefinitionCreate, ServiceDefinitionUpdate
from services.service_definition_service import (
    add_service_definition,
    remove_service_definition,
    retrieve_service_definition_by_id,
    retrieve_service_definitions,
    update_service_definition_by_id,
)

router = APIRouter(prefix="/service-definitions", tags=["Admin Service Definitions"])


@router.get("/")
@document_response(message="ServiceDefinition list fetched successfully", success_example=[])
async def list_service_definitions(
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
    return await retrieve_service_definitions(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ServiceDefinition fetched successfully")
async def get_service_definition(id: str = Path(..., description="Resource identifier")):
    return await retrieve_service_definition_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ServiceDefinition created successfully", status_code=status.HTTP_201_CREATED)
async def create_service_definition(payload: ServiceDefinitionBase):
    return await add_service_definition(ServiceDefinitionCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="ServiceDefinition updated successfully")
async def patch_service_definition(id: str, payload: ServiceDefinitionUpdate):
    return await update_service_definition_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="ServiceDefinition deleted successfully")
async def delete_service_definition(id: str):
    await remove_service_definition(id=id)
    return None
