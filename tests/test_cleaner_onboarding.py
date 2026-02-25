from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.v1 import booking_route, cleaner_route
from core.cleaner_onboarding_cache import (
    CleanerOnboardingGateDecision,
    write_cached_onboarding_decision,
)
from core.errors import AppException, ErrorCode
from schemas.cleaner_schema import (
    CleanerLocation,
    CleanerOnboardingReviewRequest,
    CleanerOnboardingUpsertRequest,
    CleanerOut,
    CleanerPayoutInformation,
    CleanerProfile,
    DailyAvailability,
    WeeklyAvailability,
)
from schemas.imports import CleaningServices, ExperienceLevel, OnboardingStatus
from schemas.place import PlaceOut
from security.account_status_check import check_user_account_status_and_permissions
from security.auth import verify_any_token
from security.principal import AuthPrincipal
from services import cleaner_service


def _principal(
    *,
    role: str = "cleaner",
    user_id: str = "cleaner-1",
    access_token_id: str = "token-1",
) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=user_id,
        role=role,  # type: ignore[arg-type]
        access_token_id=access_token_id,
        jwt_token="jwt-1",
        token_created_at=int(time.time()),
    )


def _profile() -> CleanerProfile:
    return CleanerProfile(
        location=CleanerLocation(
            place_id="place-1",
            place=PlaceOut(
                place_id="place-1",
                name="Lagos Island",
                formatted_address="Lagos Island",
                longitude=3.4,
                latitude=6.5,
                country_code="NG",
            ),
            service_radius_miles=15,
        ),
        weekly_availability=WeeklyAvailability(
            days=[
                DailyAvailability(
                    day="MONDAY",
                    time_ranges=[{"start_time": "08:00", "end_time": "12:00"}],
                ),
                DailyAvailability(
                    day="WEDNESDAY",
                    time_ranges=[{"start_time": "10:00", "end_time": "14:00"}],
                ),
                DailyAvailability(
                    day="FRIDAY",
                    time_ranges=[{"start_time": "09:00", "end_time": "13:00"}],
                ),
            ]
        ),
        experience_level=ExperienceLevel.INTERMEDIATE,
        government_id_image_url="https://example.com/id.png",
        services=[CleaningServices.STANDARD, CleaningServices.DEEP_CLEAN],
        payout_information=CleanerPayoutInformation(
            account_holder_name="Jane Doe",
            account_number="1234567890",
            bank_name="Test Bank",
            bank_country_code="NG",
            sort_code="001",
        ),
    )


def _cleaner_out(*, onboarding_status: OnboardingStatus, profile: CleanerProfile | None = None) -> CleanerOut:
    return CleanerOut(
        _id="65f0f0f0f0f0f0f0f0f0f0f0",
        firstName="Jane",
        lastName="Doe",
        email="jane@example.com",
        password="hashed-password",
        onboarding_status=onboarding_status,
        profile=profile,
        rejection_reason="Missing government ID" if onboarding_status == OnboardingStatus.REJECTED else None,
    )


def test_cleaner_location_radius_validation():
    with pytest.raises(ValidationError):
        CleanerLocation(
            place_id="place-1",
            place=PlaceOut(
                place_id="place-1",
                name="Lagos Island",
                formatted_address="Lagos Island",
                longitude=3.4,
                latitude=6.5,
                country_code="NG",
            ),
            service_radius_miles=9,
        )


def test_weekly_availability_requires_minimum_three_days():
    with pytest.raises(ValidationError):
        WeeklyAvailability(
            days=[
                DailyAvailability(day="MONDAY", time_ranges=[{"start_time": "08:00", "end_time": "12:00"}]),
                DailyAvailability(day="TUESDAY", time_ranges=[{"start_time": "08:00", "end_time": "12:00"}]),
            ]
        )


def test_rejection_reason_required_when_admin_rejects():
    with pytest.raises(ValidationError):
        CleanerOnboardingReviewRequest(status=OnboardingStatus.REJECTED)


def test_booking_list_blocks_pending_cleaner(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        assert id == "cleaner-1"
        return _cleaner_out(onboarding_status=OnboardingStatus.PENDING)

    async def _stub_retrieve_bookings_for_principal(**_kwargs):
        raise AssertionError("retrieve_bookings_for_principal should not be called when onboarding is pending")

    monkeypatch.setattr("security.cleaner_onboarding_check.retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(booking_route, "retrieve_bookings_for_principal", _stub_retrieve_bookings_for_principal)

    app = FastAPI()
    app.include_router(booking_route.router, prefix="/v1")
    app.dependency_overrides[verify_any_token] = lambda: _principal(
        role="cleaner",
        user_id="cleaner-1",
        access_token_id="booking-pending-token",
    )

    client = TestClient(app)
    response = client.get("/v1/bookings")

    assert response.status_code == 403
    payload = response.json()
    assert payload["detail"]["code"] == ErrorCode.AUTH_PERMISSION_DENIED.value
    assert payload["detail"]["details"]["onboarding_status"] == OnboardingStatus.PENDING.value


def test_booking_list_allows_approved_cleaner(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        assert id == "cleaner-1"
        return _cleaner_out(
            onboarding_status=OnboardingStatus.APPROVED,
            profile=_profile(),
        )

    async def _stub_retrieve_bookings_for_principal(**_kwargs):
        return []

    monkeypatch.setattr("security.cleaner_onboarding_check.retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(booking_route, "retrieve_bookings_for_principal", _stub_retrieve_bookings_for_principal)

    app = FastAPI()
    app.include_router(booking_route.router, prefix="/v1")
    app.dependency_overrides[verify_any_token] = lambda: _principal(
        role="cleaner",
        user_id="cleaner-1",
        access_token_id="booking-approved-token",
    )

    client = TestClient(app)
    response = client.get("/v1/bookings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"] == []


def test_cleaner_me_route_is_accessible_while_pending(monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    app.include_router(cleaner_route.router, prefix="/v1")

    async def _stub_check_user_account_status_and_permissions():
        return _cleaner_out(onboarding_status=OnboardingStatus.PENDING)

    app.dependency_overrides[check_user_account_status_and_permissions] = _stub_check_user_account_status_and_permissions
    client = TestClient(app)

    response = client.get("/v1/cleaners/me")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["onboarding_status"] == OnboardingStatus.PENDING.value


@pytest.mark.asyncio
async def test_upsert_onboarding_resets_rejected_to_pending(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        assert id == "cleaner-1"
        return _cleaner_out(
            onboarding_status=OnboardingStatus.REJECTED,
            profile=_profile(),
        )

    async def _stub_update_user_by_id(user_id: str, user_data, is_password_getting_changed: bool = False):
        assert user_id == "cleaner-1"
        assert user_data.onboarding_status == OnboardingStatus.PENDING
        assert user_data.rejection_reason is None
        assert user_data.profile is not None
        return _cleaner_out(
            onboarding_status=OnboardingStatus.PENDING,
            profile=user_data.profile,
        )

    monkeypatch.setattr(cleaner_service, "retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(cleaner_service, "update_user_by_id", _stub_update_user_by_id)
    monkeypatch.setattr(cleaner_service, "invalidate_cleaner_onboarding_cache", lambda _cleaner_id: None)

    result = await cleaner_service.upsert_cleaner_onboarding_profile(
        cleaner_id="cleaner-1",
        payload=CleanerOnboardingUpsertRequest(profile=_profile()),
    )
    assert result.onboarding_status == OnboardingStatus.PENDING


@pytest.mark.asyncio
async def test_review_onboarding_approve_requires_profile(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        assert id == "cleaner-1"
        return _cleaner_out(onboarding_status=OnboardingStatus.PENDING, profile=None)

    monkeypatch.setattr(cleaner_service, "retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)

    with pytest.raises(AppException) as exc_info:
        await cleaner_service.review_cleaner_onboarding(
            cleaner_id="cleaner-1",
            payload=CleanerOnboardingReviewRequest(status=OnboardingStatus.APPROVED),
        )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == ErrorCode.VALIDATION_FAILED.value


def test_onboarding_cache_uses_access_token_key(monkeypatch: pytest.MonkeyPatch):
    calls: dict[str, object] = {}

    class _FakeRedis:
        def setex(self, key, ttl, value):
            calls["setex"] = (key, ttl, value)

        def sadd(self, key, value):
            calls["sadd"] = (key, value)

        def expire(self, key, ttl):
            calls["expire"] = (key, ttl)

    monkeypatch.setattr("core.cleaner_onboarding_cache.cache_db", _FakeRedis())

    write_cached_onboarding_decision(
        principal=_principal(),
        cleaner_id="cleaner-1",
        decision=CleanerOnboardingGateDecision(
            onboarding_status=OnboardingStatus.PENDING,
            rejection_reason=None,
            missing_fields=["profile"],
        ),
    )

    setex = calls["setex"]
    assert isinstance(setex, tuple)
    assert "token-1" in setex[0]
