from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.chat_intervention import ChatInterventionCreate, ChatInterventionOut, ChatInterventionUpdate


def _collection():
    return db.chat_interventions


async def create_chat_intervention(payload: ChatInterventionCreate) -> ChatInterventionOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return ChatInterventionOut(**row)


async def get_chat_intervention(filter_dict: dict) -> Optional[ChatInterventionOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return ChatInterventionOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch chat_intervention: {err}") from err


async def get_chat_interventions(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[ChatInterventionOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[ChatInterventionOut] = []
    async for row in cursor:
        items.append(ChatInterventionOut(**row))
    return items


async def update_chat_intervention(filter_dict: dict, payload: ChatInterventionUpdate) -> ChatInterventionOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return ChatInterventionOut(**row)


async def delete_chat_intervention(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
