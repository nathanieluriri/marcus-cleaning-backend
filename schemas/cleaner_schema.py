from __future__ import annotations

from datetime import datetime
import time
from typing import Literal

from pydantic import ConfigDict, Field, HttpUrl, model_validator

from schemas.imports import *
from schemas.place import PlaceOut
from security.hash import hash_password


class DayOfWeek(str, Enum):
    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"
    SATURDAY = "SATURDAY"
    SUNDAY = "SUNDAY"


class AvailabilityTimeRange(BaseModel):
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(pattern=r"^\d{2}:\d{2}$")

    @model_validator(mode="after")
    def validate_time_range(self):
        start = datetime.strptime(self.start_time, "%H:%M")
        end = datetime.strptime(self.end_time, "%H:%M")
        if start >= end:
            raise ValueError("start_time must be earlier than end_time")
        return self


class DailyAvailability(BaseModel):
    day: DayOfWeek
    time_ranges: List[AvailabilityTimeRange] = Field(min_length=1)


class WeeklyAvailability(BaseModel):
    days: List[DailyAvailability] = Field(min_length=3, max_length=7)

    @model_validator(mode="after")
    def validate_weekly_availability(self):
        unique_days = {entry.day for entry in self.days}
        if len(unique_days) < 3:
            raise ValueError("weekly_availability must include at least 3 unique days")
        if len(unique_days) != len(self.days):
            raise ValueError("weekly_availability cannot contain duplicate days")
        return self


class CleanerLocation(BaseModel):
    place_id: str
    place: PlaceOut
    service_radius_miles: int = Field(ge=10, le=50)

    @model_validator(mode="after")
    def validate_place_consistency(self):
        if self.place.place_id != self.place_id:
            raise ValueError("location.place_id must match location.place.place_id")
        return self


class CleanerPayoutInformation(BaseModel):
    account_holder_name: str = Field(min_length=2)
    account_number: str = Field(min_length=4)
    bank_name: str = Field(min_length=2)
    bank_country_code: str = Field(min_length=2, max_length=2)
    iban: str | None = None
    sort_code: str | None = None
    routing_number: str | None = None


class CleanerProfile(BaseModel):
    location: CleanerLocation
    weekly_availability: WeeklyAvailability
    experience_level: ExperienceLevel
    government_id_image_url: HttpUrl
    services: List[CleaningServices] = Field(min_length=1)
    payout_information: CleanerPayoutInformation


class CleanerOnboardingUpsertRequest(BaseModel):
    profile: CleanerProfile


class CleanerOnboardingReviewRequest(BaseModel):
    status: Literal[OnboardingStatus.APPROVED, OnboardingStatus.REJECTED]
    rejection_reason: str | None = None

    @model_validator(mode="after")
    def validate_rejection_reason(self):
        if self.status == OnboardingStatus.REJECTED and not (self.rejection_reason or "").strip():
            raise ValueError("rejection_reason is required when onboarding status is REJECTED")
        return self


def get_cleaner_profile_missing_fields(profile: CleanerProfile | None) -> list[str]:
    if profile is None:
        return ["profile"]
    return []


class CleanerSignupRequest(BaseModel):
    firstName: str
    lastName: str
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CleanerBase(BaseModel):
    firstName: str
    lastName: str
    loginType: Optional[LoginType] = None
    email: EmailStr
    password: str | bytes
    accountStatus: AccountStatus = AccountStatus.ACTIVE
    permissionList: Optional[PermissionList] = None
    profile: CleanerProfile | None = None
    onboarding_status: OnboardingStatus = OnboardingStatus.PENDING
    rejection_reason: str | None = None

    @model_validator(mode="after")
    def validate_rejection_reason(self):
        if self.onboarding_status == OnboardingStatus.REJECTED and not (self.rejection_reason or "").strip():
            raise ValueError("rejection_reason is required when onboarding status is REJECTED")
        return self


class CleanerLogin(BaseModel):
    email: EmailStr
    password: str | bytes

    model_config = {"extra": "forbid"}


class CleanerRefresh(BaseModel):
    refresh_token: str


class CleanerCreate(CleanerBase):
    date_created: int = Field(default_factory=lambda: int(time.time()))
    last_updated: int = Field(default_factory=lambda: int(time.time()))

    @model_validator(mode='after')
    def obscure_password(self):
        self.password = hash_password(self.password)
        return self


class CleanerUpdate(BaseModel):
    profile: CleanerProfile | None = None
    onboarding_status: OnboardingStatus | None = None
    rejection_reason: str | None = None
    last_updated: int = Field(default_factory=lambda: int(time.time()))

    @model_validator(mode="after")
    def validate_rejection_reason(self):
        if self.onboarding_status == OnboardingStatus.REJECTED and not (self.rejection_reason or "").strip():
            raise ValueError("rejection_reason is required when onboarding status is REJECTED")
        return self


class CleanerOut(CleanerBase):
    id: Optional[str] = Field(default=None, alias="_id")
    date_created: Optional[int] = None
    last_updated: Optional[int] = None
    refresh_token: Optional[str] = None
    access_token: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def convert_objectid(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str},
    )
