from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


SignupBucket = Literal["day", "week", "month"]


class AdminUserGrowthSummaryOut(BaseModel):
    total_customers: int
    total_cleaners: int
    new_customers_period: int
    new_cleaners_period: int
    pending_cleaner_onboarding: int
    approved_cleaner_onboarding: int
    rejected_cleaner_onboarding: int
    from_epoch: int
    to_epoch: int


class AdminSignupTrendPointOut(BaseModel):
    epoch: int
    customers: int = Field(default=0, ge=0)
    cleaners: int = Field(default=0, ge=0)


class AdminSignupTrendOut(BaseModel):
    bucket: SignupBucket
    from_epoch: int
    to_epoch: int
    points: list[AdminSignupTrendPointOut]
