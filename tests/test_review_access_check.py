from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from security.review_access_check import (
    require_review_create_access,
    require_review_delete_access,
    require_review_update_access,
)


class _StubCollection:
    def __init__(self, resolver):
        self._resolver = resolver

    async def find_one(self, filter_dict):
        return self._resolver(filter_dict)


def _make_request(payload: dict):
    async def _json():
        return payload

    return SimpleNamespace(json=_json)


@pytest.mark.asyncio
async def test_require_review_create_access_allows_first_review(monkeypatch: pytest.MonkeyPatch):
    stub_db = SimpleNamespace(
        bookings=_StubCollection(lambda _filter: {"customer_id": "customer-1", "cleaner_id": "cleaner-1"}),
        reviews=_StubCollection(lambda _filter: None),
    )
    monkeypatch.setattr("security.review_access_check.db", stub_db)

    access = await require_review_create_access(
        request=_make_request(
            {
                "customer_id": "customer-1",
                "booking_id": "booking-1",
                "comment": "Great job",
                "stars": 5,
            }
        ),
        customer=SimpleNamespace(id="customer-1"),
    )

    assert access.customer_id == "customer-1"
    assert access.booking_id == "booking-1"
    assert access.cleaner_id == "cleaner-1"


@pytest.mark.asyncio
async def test_require_review_create_access_blocks_duplicate_review(monkeypatch: pytest.MonkeyPatch):
    stub_db = SimpleNamespace(
        bookings=_StubCollection(lambda _filter: {"customer_id": "customer-1", "cleaner_id": "cleaner-1"}),
        reviews=_StubCollection(lambda _filter: {"_id": "review-1"}),
    )
    monkeypatch.setattr("security.review_access_check.db", stub_db)

    with pytest.raises(HTTPException) as exc_info:
        await require_review_create_access(
            request=_make_request(
                {
                    "customer_id": "customer-1",
                    "booking_id": "booking-1",
                    "comment": "Great job",
                    "stars": 5,
                }
            ),
            customer=SimpleNamespace(id="customer-1"),
        )

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_require_review_create_access_rejects_booking_not_owned(monkeypatch: pytest.MonkeyPatch):
    stub_db = SimpleNamespace(
        bookings=_StubCollection(lambda _filter: {"customer_id": "customer-2", "cleaner_id": "cleaner-1"}),
        reviews=_StubCollection(lambda _filter: None),
    )
    monkeypatch.setattr("security.review_access_check.db", stub_db)

    with pytest.raises(HTTPException) as exc_info:
        await require_review_create_access(
            request=_make_request(
                {
                    "customer_id": "customer-1",
                    "booking_id": "booking-1",
                    "comment": "Great job",
                    "stars": 5,
                }
            ),
            customer=SimpleNamespace(id="customer-1"),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_review_update_access_rejects_other_customers_review(
    monkeypatch: pytest.MonkeyPatch,
):
    async def _stub_retrieve_review_by_id(*, id: str):
        assert id == "review-1"
        return SimpleNamespace(customer_id="customer-2", booking_id="booking-1")

    monkeypatch.setattr(
        "security.review_access_check.retrieve_review_by_review_id",
        _stub_retrieve_review_by_id,
    )
    stub_db = SimpleNamespace(
        bookings=_StubCollection(lambda _filter: {"customer_id": "customer-1", "cleaner_id": "cleaner-1"}),
        reviews=_StubCollection(lambda _filter: None),
    )
    monkeypatch.setattr("security.review_access_check.db", stub_db)

    with pytest.raises(HTTPException) as exc_info:
        await require_review_update_access(
            id="review-1",
            customer=SimpleNamespace(id="customer-1"),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_require_review_delete_access_allows_owner(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_review_by_id(*, id: str):
        assert id == "review-1"
        return SimpleNamespace(customer_id="customer-1", booking_id="booking-1")

    monkeypatch.setattr(
        "security.review_access_check.retrieve_review_by_review_id",
        _stub_retrieve_review_by_id,
    )
    stub_db = SimpleNamespace(
        bookings=_StubCollection(lambda _filter: {"customer_id": "customer-1", "cleaner_id": "cleaner-1"}),
        reviews=_StubCollection(lambda _filter: None),
    )
    monkeypatch.setattr("security.review_access_check.db", stub_db)

    access = await require_review_delete_access(
        id="review-1",
        customer=SimpleNamespace(id="customer-1"),
    )

    assert access.review_id == "review-1"
    assert access.booking_id == "booking-1"
    assert access.customer_id == "customer-1"
