from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, model_validator

from schemas.imports import ObjectId


class PaymentIntentIn(BaseModel):
    amount_minor: int = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    reference: str = Field(min_length=3)
    customer_email: str | None = None
    provider: str | None = None
    metadata: dict[str, Any] | None = None


class RefundIn(BaseModel):
    amount_minor: int | None = Field(default=None, gt=0)


class PaymentTransactionCreate(BaseModel):
    owner_id: str
    booking_id: str | None = None
    provider: str
    reference: str
    status: str
    amount_minor: int
    currency: str
    response_payload: dict[str, Any]
    idempotency_key: str
    created_at: int
    updated_at: int


class PaymentTransactionOut(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    owner_id: str
    booking_id: str | None = None
    provider: str
    reference: str
    status: str
    amount_minor: int
    currency: str
    response_payload: dict[str, Any]
    idempotency_key: str
    created_at: int
    updated_at: int

    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if isinstance(values, dict) and "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values


class WebhookReplayCreate(BaseModel):
    provider: str
    event_id: str
    created_at: int


class PaymentMethodCreateIn(BaseModel):
    provider: str = Field(min_length=1)
    provider_method_ref: str = Field(min_length=1)
    type: str = Field(min_length=1)
    label: str | None = Field(default=None, min_length=1, max_length=80)
    brand: str | None = Field(default=None, min_length=1, max_length=40)
    last4: str | None = Field(default=None, pattern=r"^\d{4}$")
    exp_month: int | None = Field(default=None, ge=1, le=12)
    exp_year: int | None = Field(default=None, ge=2000)
    bank_name: str | None = Field(default=None, min_length=1, max_length=80)
    is_default: bool | None = None

    model_config = {"extra": "forbid"}


class PaymentMethodUpdateIn(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    brand: str | None = Field(default=None, min_length=1, max_length=40)
    exp_month: int | None = Field(default=None, ge=1, le=12)
    exp_year: int | None = Field(default=None, ge=2000)
    bank_name: str | None = Field(default=None, min_length=1, max_length=80)
    status: str | None = Field(default=None, min_length=1, max_length=20)

    model_config = {"extra": "forbid"}


class PaymentMethodCreate(BaseModel):
    owner_id: str
    provider: str
    provider_method_ref: str
    type: str
    label: str | None = None
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    bank_name: str | None = None
    is_default: bool = False
    status: str = "active"
    created_at: int
    updated_at: int


class PaymentMethodUpdate(BaseModel):
    label: str | None = None
    brand: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    bank_name: str | None = None
    status: str | None = None
    updated_at: int


class PaymentMethodOut(BaseModel):
    id: str | None = Field(default=None, alias="_id")
    owner_id: str
    provider: str
    provider_method_ref: str
    type: str
    label: str | None = None
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    bank_name: str | None = None
    is_default: bool
    status: str
    created_at: int
    updated_at: int

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_method(cls, values):
        if isinstance(values, dict) and "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values
