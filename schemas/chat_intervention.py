from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class ChatInterventionBase(BaseModel):
    thread_id: str = Field(min_length=2)
    customer_id: str = Field(min_length=2)
    cleaner_id: str = Field(min_length=2)
    admin_id: str = Field(min_length=2)
    action: str = Field(min_length=2, max_length=40)
    note: str | None = None


class ChatInterventionCreateRequest(BaseModel):
    thread_id: str = Field(min_length=2)
    customer_id: str = Field(min_length=2)
    cleaner_id: str = Field(min_length=2)
    action: str = Field(min_length=2, max_length=40)
    note: str | None = None


class ChatInterventionCreate(ChatInterventionBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ChatInterventionUpdate(BaseModel):
    thread_id: str | None = None
    customer_id: str | None = None
    cleaner_id: str | None = None
    action: str | None = None
    note: str | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ChatInterventionOut(ChatInterventionBase):
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
