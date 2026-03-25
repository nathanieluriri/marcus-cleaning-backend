from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.cleaner_skill_equipment_tag import CleanerSkillEquipmentTagBase, CleanerSkillEquipmentTagCreate, CleanerSkillEquipmentTagUpdate
from services.cleaner_skill_equipment_tag_service import (
    add_cleaner_skill_equipment_tag,
    remove_cleaner_skill_equipment_tag,
    retrieve_cleaner_skill_equipment_tag_by_id,
    retrieve_cleaner_skill_equipment_tags,
    update_cleaner_skill_equipment_tag_by_id,
)

router = APIRouter(prefix="/cleaner-tags", tags=["Admin Cleaner Tags"])


@router.get("/")
@document_response(message="CleanerSkillEquipmentTag list fetched successfully", success_example=[])
async def list_cleaner_skill_equipment_tags(
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
    return await retrieve_cleaner_skill_equipment_tags(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="CleanerSkillEquipmentTag fetched successfully")
async def get_cleaner_skill_equipment_tag(id: str = Path(..., description="Resource identifier")):
    return await retrieve_cleaner_skill_equipment_tag_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="CleanerSkillEquipmentTag created successfully", status_code=status.HTTP_201_CREATED)
async def create_cleaner_skill_equipment_tag(payload: CleanerSkillEquipmentTagBase):
    return await add_cleaner_skill_equipment_tag(CleanerSkillEquipmentTagCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="CleanerSkillEquipmentTag updated successfully")
async def patch_cleaner_skill_equipment_tag(id: str, payload: CleanerSkillEquipmentTagUpdate):
    return await update_cleaner_skill_equipment_tag_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="CleanerSkillEquipmentTag deleted successfully")
async def delete_cleaner_skill_equipment_tag(id: str):
    await remove_cleaner_skill_equipment_tag(id=id)
    return None
