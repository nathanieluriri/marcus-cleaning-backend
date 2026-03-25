from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class CleanerSkillEquipmentTagBase(BaseModel):
    cleaner_id: str = Field(min_length=2)
    tag: str = Field(min_length=2, max_length=80)
    tag_type: str = Field(min_length=2, max_length=40)
    is_verified: bool = False
    verified_by_admin_id: str | None = None


class CleanerSkillEquipmentTagCreate(CleanerSkillEquipmentTagBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class CleanerSkillEquipmentTagUpdate(BaseModel):
    cleaner_id: str | None = None
    tag: str | None = None
    tag_type: str | None = None
    is_verified: bool | None = None
    verified_by_admin_id: str | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class CleanerSkillEquipmentTagOut(CleanerSkillEquipmentTagBase):
    id: str | None = Field(default=None, validation_alias=AliasChoices("_id", "id"), serialization_alias="id")
    date_created: int | None = Field(default=None, validation_alias=AliasChoices("date_created", "dateCreated"), serialization_alias="dateCreated")
    last_updated: int | None = Field(default=None, validation_alias=AliasChoices("last_updated", "lastUpdated"), serialization_alias="lastUpdated")

    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values: dict[str, Any]):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True, json_encoders={ObjectId: str})
