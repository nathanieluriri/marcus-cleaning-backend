from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from schemas.imports import AccountStatus, OnboardingStatus

ADMIN_LIST_DEFAULT_START = 0
ADMIN_LIST_DEFAULT_STOP = 100
ADMIN_LIST_MAX_STOP = 100


class AdminCustomerListItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    legacy_id: str = Field(alias="_id")
    firstName: str
    lastName: str
    email: str
    phoneNumber: str | None = None
    accountStatus: AccountStatus
    date_created: int | None = None
    last_updated: int | None = None


class AdminCleanerListItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    legacy_id: str = Field(alias="_id")
    firstName: str
    lastName: str
    email: str
    accountStatus: AccountStatus
    allow_admin_selection: bool = False
    onboarding_status: OnboardingStatus
    rejection_reason: str | None = None
    date_created: int | None = None
    last_updated: int | None = None


class AdminCleanerDetailItem(AdminCleanerListItem):
    profile: dict | None = None


class AdminCustomerDetailItem(AdminCustomerListItem):
    avatarDocumentId: str | None = None
    permissionList: dict | None = None


class AdminOnboardingQueueItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    legacy_id: str = Field(alias="_id")
    fullName: str
    email: str
    onboarding_status: OnboardingStatus
    profileCompleteness: int = Field(ge=0, le=100)
    missingRequirements: list[str] = Field(default_factory=list)
    submittedAt: int | None = None
    slaAgeHours: int = Field(ge=0, default=0)


class AdminUserAutocompleteItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    legacy_id: str = Field(alias="_id")
    role: Literal["customer", "cleaner"]
    firstName: str
    lastName: str
    email: str
    onboarding_status: OnboardingStatus | None = None
    allow_admin_selection: bool | None = None


class AdminUserAutocompleteResult(BaseModel):
    query: str
    customers: list[AdminUserAutocompleteItem] = Field(default_factory=list)
    cleaners: list[AdminUserAutocompleteItem] = Field(default_factory=list)


def compute_sla_age_hours(submitted_at_epoch: int | None) -> int:
    if submitted_at_epoch is None:
        return 0
    now = int(time.time())
    if submitted_at_epoch >= now:
        return 0
    return int((now - submitted_at_epoch) / 3600)
