from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.chat_intervention import create_chat_intervention, delete_chat_intervention, get_chat_intervention, get_chat_interventions, update_chat_intervention
from schemas.chat_intervention import ChatInterventionCreate, ChatInterventionOut, ChatInterventionUpdate


async def add_chat_intervention(payload: ChatInterventionCreate) -> ChatInterventionOut:
    return await create_chat_intervention(payload)


async def retrieve_chat_intervention_by_id(*, id: str) -> ChatInterventionOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_chat_intervention({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ChatIntervention not found")
    return result


async def retrieve_chat_interventions(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ChatInterventionOut]:
    return await get_chat_interventions(filter_dict=filters or {}, start=start, stop=stop)


async def update_chat_intervention_by_id(*, id: str, payload: ChatInterventionUpdate) -> ChatInterventionOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_chat_intervention({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="ChatIntervention not found")
    return result


async def remove_chat_intervention(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_chat_intervention({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ChatIntervention not found")
    return True
