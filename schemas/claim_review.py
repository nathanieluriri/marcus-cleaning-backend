from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class ClaimReviewBase(BaseModel):
    booking_id: str = Field(min_length=2)
    customer_id: str = Field(min_length=2)
    cleaner_id: str = Field(min_length=2)
    claim_type: str = Field(min_length=2, max_length=60)
    description: str = Field(min_length=2, max_length=5000)
    evidence_urls: list[str] = Field(default_factory=list)
    decision: str | None = Field(default=None, min_length=2, max_length=40)
    decision_note: str | None = None
    decided_by_admin_id: str | None = None


class ClaimReviewCreate(ClaimReviewBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ClaimReviewUpdate(BaseModel):
    booking_id: str | None = None
    customer_id: str | None = None
    cleaner_id: str | None = None
    claim_type: str | None = None
    description: str | None = None
    evidence_urls: list[str] | None = None
    decision: str | None = Field(default=None, min_length=2, max_length=40)
    decision_note: str | None = None
    decided_by_admin_id: str | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ClaimReviewOut(ClaimReviewBase):
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
