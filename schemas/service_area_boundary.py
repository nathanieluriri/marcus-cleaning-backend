from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class ServiceAreaBoundaryBase(BaseModel):
    zone_code: str = Field(min_length=2, max_length=40)
    display_name: str = Field(min_length=2, max_length=120)
    zip_codes: list[str] = Field(default_factory=list)
    boundary_geojson: dict[str, Any] | None = None
    is_active: bool = True


class ServiceAreaBoundaryCreate(ServiceAreaBoundaryBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ServiceAreaBoundaryUpdate(BaseModel):
    zone_code: str | None = None
    display_name: str | None = None
    zip_codes: list[str] | None = None
    boundary_geojson: dict[str, Any] | None = None
    is_active: bool | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ServiceAreaBoundaryOut(ServiceAreaBoundaryBase):
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
