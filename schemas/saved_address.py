from __future__ import annotations

import time

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from schemas.imports import ObjectId
from schemas.place import PlaceOut


class SavedAddressBase(BaseModel):
    user_id: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=80)
    addressLine: str = Field(min_length=1, max_length=300)
    place: PlaceOut
    isDefault: bool = False


class SavedAddressCreate(SavedAddressBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class SavedAddressUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    addressLine: str | None = Field(default=None, min_length=1, max_length=300)
    place: PlaceOut | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class SavedAddressCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    addressLine: str = Field(min_length=1, max_length=300)
    place: PlaceOut
    isDefault: bool | None = None


class SavedAddressPatchRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    addressLine: str | None = Field(default=None, min_length=1, max_length=300)
    place: PlaceOut | None = None


class SavedAddressOut(SavedAddressBase):
    id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("_id", "id"),
        serialization_alias="id",
    )
    date_created: int | None = Field(
        default=None,
        validation_alias=AliasChoices("date_created", "dateCreated"),
        serialization_alias="dateCreated",
    )
    last_updated: int | None = Field(
        default=None,
        validation_alias=AliasChoices("last_updated", "lastUpdated"),
        serialization_alias="lastUpdated",
    )

    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if isinstance(values, dict) and "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = ConfigDict(populate_by_name=True)
