from __future__ import annotations

import time

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from schemas.imports import ObjectId
from schemas.place import PlaceOut


class AutocompleteSearchResultBase(BaseModel):
    search_input: str = Field(min_length=2)
    user_id: str = Field(min_length=1)
    place: PlaceOut


class AutocompleteSearchResultSaveRequest(BaseModel):
    search_input: str = Field(min_length=2)
    place: PlaceOut


class AutocompleteSearchResultCreate(AutocompleteSearchResultBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class AutocompleteSearchResultUpdate(BaseModel):
    search_input: str | None = Field(default=None, min_length=2)
    place: PlaceOut | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class AutocompleteSearchResultOut(AutocompleteSearchResultBase):
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
