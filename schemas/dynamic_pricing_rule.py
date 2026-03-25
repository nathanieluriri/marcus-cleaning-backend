from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class DynamicPricingRuleBase(BaseModel):
    rule_name: str = Field(min_length=2, max_length=120)
    rule_type: str = Field(min_length=2, max_length=40)
    multiplier: float = Field(gt=0)
    priority: int = Field(ge=0, le=1000)
    zone_codes: list[str] = Field(default_factory=list)
    day_of_week: list[int] = Field(default_factory=list)
    start_hour: int | None = Field(default=None, ge=0, le=23)
    end_hour: int | None = Field(default=None, ge=0, le=23)
    is_active: bool = True


class DynamicPricingRuleCreate(DynamicPricingRuleBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class DynamicPricingRuleUpdate(BaseModel):
    rule_name: str | None = None
    rule_type: str | None = None
    multiplier: float | None = None
    priority: int | None = None
    zone_codes: list[str] | None = None
    day_of_week: list[int] | None = None
    start_hour: int | None = Field(default=None, ge=0, le=23)
    end_hour: int | None = Field(default=None, ge=0, le=23)
    is_active: bool | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class DynamicPricingRuleOut(DynamicPricingRuleBase):
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
