from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from schemas.imports import AccountStatus, OnboardingStatus
from services import admin_service


@pytest.mark.asyncio
async def test_retrieve_admin_customers_returns_id_and_alias(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_customers(*, filter_dict, start: int, stop: int):
        assert filter_dict == {}
        assert start == 0
        assert stop == 50
        return [
            SimpleNamespace(
                id="67f0f0f0f0f0f0f0f0f0f0f1",
                firstName="Jane",
                lastName="Doe",
                email="jane@example.com",
                phoneNumber="+2348010000000",
                accountStatus=AccountStatus.ACTIVE,
                date_created=1,
                last_updated=2,
            )
        ]

    monkeypatch.setattr(admin_service, "get_customers", _stub_get_customers)
    items = await admin_service.retrieve_admin_customers(start=0, stop=50)

    assert len(items) == 1
    assert items[0].id == "67f0f0f0f0f0f0f0f0f0f0f1"
    assert items[0].legacy_id == "67f0f0f0f0f0f0f0f0f0f0f1"


@pytest.mark.asyncio
async def test_retrieve_admin_cleaners_applies_onboarding_filter(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_cleaners(*, filter_dict, start: int, stop: int):
        assert filter_dict == {"onboarding_status": OnboardingStatus.PENDING.value}
        assert start == 0
        assert stop == 10
        return [
            SimpleNamespace(
                id="67f0f0f0f0f0f0f0f0f0f0f2",
                firstName="John",
                lastName="Cleaner",
                email="john@example.com",
                accountStatus=AccountStatus.ACTIVE,
                onboarding_status=OnboardingStatus.PENDING,
                rejection_reason=None,
                date_created=1,
                last_updated=2,
            )
        ]

    monkeypatch.setattr(admin_service, "get_cleaners", _stub_get_cleaners)
    items = await admin_service.retrieve_admin_cleaners(
        start=0,
        stop=10,
        onboarding_status=OnboardingStatus.PENDING,
    )

    assert len(items) == 1
    assert items[0].onboarding_status == OnboardingStatus.PENDING


@pytest.mark.asyncio
async def test_retrieve_admin_cleaner_detail_invalid_id_returns_400():
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.retrieve_admin_cleaner_detail(cleaner_id="not-an-object-id")

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid cleaner ID format"


@pytest.mark.asyncio
async def test_retrieve_admin_cleaner_detail_not_found_returns_404(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_cleaner(_query: dict):
        return None

    monkeypatch.setattr(admin_service, "get_cleaner", _stub_get_cleaner)

    with pytest.raises(HTTPException) as exc_info:
        await admin_service.retrieve_admin_cleaner_detail(cleaner_id="67f0f0f0f0f0f0f0f0f0f0f3")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Cleaner not found"


@pytest.mark.asyncio
async def test_retrieve_admin_cleaner_detail_returns_profile_with_id_alias(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_cleaner(_query: dict):
        return SimpleNamespace(
            id="67f0f0f0f0f0f0f0f0f0f0f4",
            firstName="Ada",
            lastName="Spark",
            email="ada@example.com",
            accountStatus=AccountStatus.ACTIVE,
            onboarding_status=OnboardingStatus.APPROVED,
            rejection_reason=None,
            date_created=1,
            last_updated=2,
            profile=SimpleNamespace(model_dump=lambda mode="json": {"location": {"place_id": "abc"}}),
        )

    monkeypatch.setattr(admin_service, "get_cleaner", _stub_get_cleaner)
    item = await admin_service.retrieve_admin_cleaner_detail(cleaner_id="67f0f0f0f0f0f0f0f0f0f0f4")

    assert item.id == "67f0f0f0f0f0f0f0f0f0f0f4"
    assert item.legacy_id == "67f0f0f0f0f0f0f0f0f0f0f4"
    assert item.profile == {"location": {"place_id": "abc"}}


@pytest.mark.asyncio
async def test_retrieve_admin_customer_detail_returns_detail(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_customer(_query: dict):
        return SimpleNamespace(
            id="67f0f0f0f0f0f0f0f0f0f0f5",
            firstName="Customer",
            lastName="One",
            email="customer1@example.com",
            phoneNumber=None,
            accountStatus=AccountStatus.ACTIVE,
            date_created=1,
            last_updated=2,
            avatarDocumentId=None,
            permissionList=None,
        )

    monkeypatch.setattr(admin_service, "get_customer", _stub_get_customer)
    item = await admin_service.retrieve_admin_customer_detail(customer_id="67f0f0f0f0f0f0f0f0f0f0f5")
    assert item.id == "67f0f0f0f0f0f0f0f0f0f0f5"
    assert item.legacy_id == "67f0f0f0f0f0f0f0f0f0f0f5"


@pytest.mark.asyncio
async def test_retrieve_admin_onboarding_queue_returns_projection(monkeypatch: pytest.MonkeyPatch):
    class _AsyncCursor:
        def __init__(self):
            self._rows = [
                {
                    "_id": "67f0f0f0f0f0f0f0f0f0f0f6",
                    "firstName": "Queue",
                    "lastName": "Cleaner",
                    "email": "queue@example.com",
                    "password": "hashed",
                    "accountStatus": "ACTIVE",
                    "onboarding_status": "PENDING",
                    "date_created": 1,
                    "profile": {
                        "location": {
                            "place_id": "abc",
                            "place": {
                                "place_id": "abc",
                                "name": "Test Place",
                                "formatted_address": "123 Test Street",
                                "longitude": 1.0,
                                "latitude": 1.0,
                                "country_code": "NG",
                                "description": "Test",
                            },
                            "service_radius_miles": 10,
                        },
                        "weekly_availability": {
                            "days": [
                                {"day": "MONDAY", "time_ranges": [{"start_time": "08:00", "end_time": "10:00"}]},
                                {"day": "TUESDAY", "time_ranges": [{"start_time": "08:00", "end_time": "10:00"}]},
                                {"day": "WEDNESDAY", "time_ranges": [{"start_time": "08:00", "end_time": "10:00"}]},
                            ]
                        },
                        "experience_level": "BEGINNER",
                        "government_id_image_url": "https://example.com/id.png",
                        "services": ["STANDARD"],
                        "payout_information": {
                            "account_holder_name": "Queue Cleaner",
                            "account_number": "12345678",
                            "bank_name": "Test Bank",
                            "bank_country_code": "NG",
                        },
                    },
                }
            ]
            self._index = 0

        def sort(self, *_args, **_kwargs):
            return self

        def skip(self, *_args, **_kwargs):
            return self

        def limit(self, *_args, **_kwargs):
            return self

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._index >= len(self._rows):
                raise StopAsyncIteration
            row = self._rows[self._index]
            self._index += 1
            return row

    class _CleanerCollection:
        def find(self, query, *_args, **_kwargs):
            assert query["onboarding_status"] == "PENDING"
            return _AsyncCursor()

    monkeypatch.setattr(admin_service, "db", SimpleNamespace(cleaners=_CleanerCollection()))

    items = await admin_service.retrieve_admin_onboarding_queue(start=0, stop=10, sort="submitted_at", search=None)
    assert len(items) == 1
    assert items[0].profileCompleteness == 100
    assert items[0].id == items[0].legacy_id


@pytest.mark.asyncio
async def test_retrieve_admin_cleaners_rejects_invalid_window():
    with pytest.raises(HTTPException) as exc_info:
        await admin_service.retrieve_admin_cleaners(start=10, stop=10)

    assert exc_info.value.status_code == 422
