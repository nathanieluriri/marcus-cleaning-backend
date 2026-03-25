from __future__ import annotations

import time
from typing import Any

from pydantic import AliasChoices, ConfigDict, Field, model_validator

from schemas.imports import BaseModel, ObjectId


class ServiceCreditLedgerBase(BaseModel):
    customer_id: str = Field(min_length=2)
    amount_minor: int
    currency: str = Field(min_length=3, max_length=3)
    entry_type: str = Field(min_length=2, max_length=20)
    source: str = Field(min_length=2, max_length=60)
    booking_id: str | None = None
    payment_id: str | None = None
    note: str | None = None


class ServiceCreditLedgerCreate(ServiceCreditLedgerBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ServiceCreditLedgerUpdate(BaseModel):
    customer_id: str | None = None
    amount_minor: int | None = None
    currency: str | None = None
    entry_type: str | None = None
    source: str | None = None
    booking_id: str | None = None
    payment_id: str | None = None
    note: str | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class ServiceCreditLedgerOut(ServiceCreditLedgerBase):
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
