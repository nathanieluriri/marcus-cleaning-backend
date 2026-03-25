from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.service_definition import create_service_definition, delete_service_definition, get_service_definition, get_service_definitions, update_service_definition
from schemas.service_definition import ServiceDefinitionCreate, ServiceDefinitionOut, ServiceDefinitionUpdate


async def add_service_definition(payload: ServiceDefinitionCreate) -> ServiceDefinitionOut:
    return await create_service_definition(payload)


async def retrieve_service_definition_by_id(*, id: str) -> ServiceDefinitionOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_service_definition({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceDefinition not found")
    return result


async def retrieve_service_definitions(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ServiceDefinitionOut]:
    return await get_service_definitions(filter_dict=filters or {}, start=start, stop=stop)


async def update_service_definition_by_id(*, id: str, payload: ServiceDefinitionUpdate) -> ServiceDefinitionOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_service_definition({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceDefinition not found")
    return result


async def remove_service_definition(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_service_definition({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ServiceDefinition not found")
    return True
