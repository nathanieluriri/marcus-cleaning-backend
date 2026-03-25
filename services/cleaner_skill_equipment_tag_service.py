from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.cleaner_skill_equipment_tag import create_cleaner_skill_equipment_tag, delete_cleaner_skill_equipment_tag, get_cleaner_skill_equipment_tag, get_cleaner_skill_equipment_tags, update_cleaner_skill_equipment_tag
from schemas.cleaner_skill_equipment_tag import CleanerSkillEquipmentTagCreate, CleanerSkillEquipmentTagOut, CleanerSkillEquipmentTagUpdate


async def add_cleaner_skill_equipment_tag(payload: CleanerSkillEquipmentTagCreate) -> CleanerSkillEquipmentTagOut:
    return await create_cleaner_skill_equipment_tag(payload)


async def retrieve_cleaner_skill_equipment_tag_by_id(*, id: str) -> CleanerSkillEquipmentTagOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_cleaner_skill_equipment_tag({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="CleanerSkillEquipmentTag not found")
    return result


async def retrieve_cleaner_skill_equipment_tags(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[CleanerSkillEquipmentTagOut]:
    return await get_cleaner_skill_equipment_tags(filter_dict=filters or {}, start=start, stop=stop)


async def update_cleaner_skill_equipment_tag_by_id(*, id: str, payload: CleanerSkillEquipmentTagUpdate) -> CleanerSkillEquipmentTagOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_cleaner_skill_equipment_tag({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="CleanerSkillEquipmentTag not found")
    return result


async def remove_cleaner_skill_equipment_tag(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_cleaner_skill_equipment_tag({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="CleanerSkillEquipmentTag not found")
    return True
