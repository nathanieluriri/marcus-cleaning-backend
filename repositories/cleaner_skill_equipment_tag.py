from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.cleaner_skill_equipment_tag import CleanerSkillEquipmentTagCreate, CleanerSkillEquipmentTagOut, CleanerSkillEquipmentTagUpdate


def _collection():
    return db.cleaner_skill_equipment_tags


async def create_cleaner_skill_equipment_tag(payload: CleanerSkillEquipmentTagCreate) -> CleanerSkillEquipmentTagOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return CleanerSkillEquipmentTagOut(**row)


async def get_cleaner_skill_equipment_tag(filter_dict: dict) -> Optional[CleanerSkillEquipmentTagOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return CleanerSkillEquipmentTagOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch cleaner_skill_equipment_tag: {err}") from err


async def get_cleaner_skill_equipment_tags(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[CleanerSkillEquipmentTagOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[CleanerSkillEquipmentTagOut] = []
    async for row in cursor:
        items.append(CleanerSkillEquipmentTagOut(**row))
    return items


async def update_cleaner_skill_equipment_tag(filter_dict: dict, payload: CleanerSkillEquipmentTagUpdate) -> CleanerSkillEquipmentTagOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return CleanerSkillEquipmentTagOut(**row)


async def delete_cleaner_skill_equipment_tag(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
