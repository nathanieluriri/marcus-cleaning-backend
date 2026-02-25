# ============================================================================
# BOOKING SCHEMA
# ============================================================================

from schemas.imports import *
from pydantic import AliasChoices, ConfigDict, Field, model_validator
import time


class BookingBase(BaseModel):
    customer_id: str
    place_id: str
    cleaner_id: str
    extras: Extra = Field(default_factory=Extra)
    service: CleaningServices
    duration: Duration
    custom_details: CustomServiceDetails | None = None

    @model_validator(mode="after")
    def validate_custom_service_details(self):
        if self.service == CleaningServices.CUSTOM and self.custom_details is None:
            raise ValueError("custom_details is required when service is CUSTOM")
        if self.service != CleaningServices.CUSTOM and self.custom_details is not None:
            raise ValueError("custom_details is only allowed when service is CUSTOM")
        return self


class BookingCreate(BookingBase):
    status: BookingStatus = BookingStatus.REQUESTED
    payment_id: str | None = None
    price_amount_minor: int | None = None
    price_currency: str | None = None
    price_breakdown: dict[str, Any] | None = None
    cleaner_accepted_at: int | None = None
    cleaner_completed_at: int | None = None
    customer_acknowledged_at: int | None = None
    cleaner_acceptance_deadline: int = Field(default_factory=lambda: int(time.time() + 10800))
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class BookingUpdate(BaseModel):
    status: BookingStatus | None = None
    payment_id: str | None = None
    price_amount_minor: int | None = None
    price_currency: str | None = None
    price_breakdown: dict[str, Any] | None = None
    cleaner_accepted_at: int | None = None
    cleaner_completed_at: int | None = None
    customer_acknowledged_at: int | None = None
    cleaner_acceptance_deadline: int | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))


class BookingOut(BookingBase):
    status: BookingStatus
    payment_id: str | None = None
    price_amount_minor: int | None = None
    price_currency: str | None = None
    price_breakdown: dict[str, Any] | None = None
    cleaner_accepted_at: int | None = None
    cleaner_completed_at: int | None = None
    customer_acknowledged_at: int | None = None
    cleaner_acceptance_deadline: int | None = None
    id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("_id", "id"),
        serialization_alias="id",
    )
    date_created: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("date_created", "dateCreated"),
        serialization_alias="dateCreated",
    )
    last_updated: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("last_updated", "lastUpdated"),
        serialization_alias="lastUpdated",
    )

    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        if "status" not in values:
            if values.get("customer_has_acknowledged_completion") is True:
                values["status"] = BookingStatus.CUSTOMER_ACKNOWLEDGED.value
            elif values.get("cleaner_has_completed") is True:
                values["status"] = BookingStatus.CLEANER_COMPLETED.value
            elif values.get("cleaner_has_accepted") is True:
                values["status"] = BookingStatus.ACCEPTED.value
            else:
                values["status"] = BookingStatus.REQUESTED.value
        if "cleaner_accepted_at" not in values and "cleaner_accepted_at_this_time" in values:
            values["cleaner_accepted_at"] = values.get("cleaner_accepted_at_this_time")
        return values

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )
