from __future__ import annotations

import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status

from core.database import db
from schemas.admin_reporting_schema import (
    AdminSignupTrendOut,
    AdminSignupTrendPointOut,
    AdminUserGrowthSummaryOut,
    SignupBucket,
)
from schemas.imports import OnboardingStatus


SECONDS_PER_DAY = 86400


def _resolve_reporting_window(*, from_epoch: int | None, to_epoch: int | None) -> tuple[int, int]:
    now = int(time.time())
    resolved_to = to_epoch if to_epoch is not None else now
    resolved_from = from_epoch if from_epoch is not None else resolved_to - 30 * SECONDS_PER_DAY
    if resolved_from < 0 or resolved_to < 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Epoch values must be positive")
    if resolved_from > resolved_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="from_epoch must be less than or equal to to_epoch",
        )
    return resolved_from, resolved_to


def _bucket_start(epoch: int, bucket: SignupBucket) -> int:
    date = datetime.fromtimestamp(epoch, tz=timezone.utc)
    if bucket == "day":
        return int(datetime(date.year, date.month, date.day, tzinfo=timezone.utc).timestamp())
    if bucket == "week":
        week_start = date - timedelta(days=date.weekday())
        return int(datetime(week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc).timestamp())
    return int(datetime(date.year, date.month, 1, tzinfo=timezone.utc).timestamp())


def _advance_bucket(epoch: int, bucket: SignupBucket) -> int:
    date = datetime.fromtimestamp(epoch, tz=timezone.utc)
    if bucket == "day":
        return int((date + timedelta(days=1)).timestamp())
    if bucket == "week":
        return int((date + timedelta(days=7)).timestamp())
    if date.month == 12:
        return int(datetime(date.year + 1, 1, 1, tzinfo=timezone.utc).timestamp())
    return int(datetime(date.year, date.month + 1, 1, tzinfo=timezone.utc).timestamp())


async def get_admin_user_growth_summary(
    *,
    from_epoch: int | None,
    to_epoch: int | None,
) -> AdminUserGrowthSummaryOut:
    resolved_from, resolved_to = _resolve_reporting_window(from_epoch=from_epoch, to_epoch=to_epoch)
    period_filter = {"date_created": {"$gte": resolved_from, "$lte": resolved_to}}

    total_customers = await db.customers.count_documents({})
    total_cleaners = await db.cleaners.count_documents({})
    new_customers_period = await db.customers.count_documents(period_filter)
    new_cleaners_period = await db.cleaners.count_documents(period_filter)
    pending_cleaner_onboarding = await db.cleaners.count_documents({"onboarding_status": OnboardingStatus.PENDING.value})
    approved_cleaner_onboarding = await db.cleaners.count_documents({"onboarding_status": OnboardingStatus.APPROVED.value})
    rejected_cleaner_onboarding = await db.cleaners.count_documents({"onboarding_status": OnboardingStatus.REJECTED.value})

    return AdminUserGrowthSummaryOut(
        total_customers=total_customers,
        total_cleaners=total_cleaners,
        new_customers_period=new_customers_period,
        new_cleaners_period=new_cleaners_period,
        pending_cleaner_onboarding=pending_cleaner_onboarding,
        approved_cleaner_onboarding=approved_cleaner_onboarding,
        rejected_cleaner_onboarding=rejected_cleaner_onboarding,
        from_epoch=resolved_from,
        to_epoch=resolved_to,
    )


async def _read_date_created_epochs(*, collection_name: str, from_epoch: int, to_epoch: int) -> list[int]:
    collection = getattr(db, collection_name)
    cursor = collection.find(
        {"date_created": {"$gte": from_epoch, "$lte": to_epoch}},
        {"date_created": 1},
    )
    epochs: list[int] = []
    async for row in cursor:
        raw_epoch = row.get("date_created")
        if isinstance(raw_epoch, int):
            epochs.append(raw_epoch)
    return epochs


async def get_admin_user_signup_trend(
    *,
    from_epoch: int | None,
    to_epoch: int | None,
    bucket: SignupBucket,
) -> AdminSignupTrendOut:
    resolved_from, resolved_to = _resolve_reporting_window(from_epoch=from_epoch, to_epoch=to_epoch)
    customer_epochs = await _read_date_created_epochs(
        collection_name="customers",
        from_epoch=resolved_from,
        to_epoch=resolved_to,
    )
    cleaner_epochs = await _read_date_created_epochs(
        collection_name="cleaners",
        from_epoch=resolved_from,
        to_epoch=resolved_to,
    )

    counts: dict[int, dict[str, int]] = defaultdict(lambda: {"customers": 0, "cleaners": 0})
    for epoch in customer_epochs:
        counts[_bucket_start(epoch, bucket)]["customers"] += 1
    for epoch in cleaner_epochs:
        counts[_bucket_start(epoch, bucket)]["cleaners"] += 1

    points: list[AdminSignupTrendPointOut] = []
    current_bucket_epoch = _bucket_start(resolved_from, bucket)
    last_bucket_epoch = _bucket_start(resolved_to, bucket)
    while current_bucket_epoch <= last_bucket_epoch:
        bucket_counts = counts.get(current_bucket_epoch, {"customers": 0, "cleaners": 0})
        points.append(
            AdminSignupTrendPointOut(
                epoch=current_bucket_epoch,
                customers=bucket_counts["customers"],
                cleaners=bucket_counts["cleaners"],
            )
        )
        current_bucket_epoch = _advance_bucket(current_bucket_epoch, bucket)

    return AdminSignupTrendOut(
        bucket=bucket,
        from_epoch=resolved_from,
        to_epoch=resolved_to,
        points=points,
    )
