from __future__ import annotations

import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from schemas.concierge_booking import AdminConciergeCreateBookingRequest
from schemas.imports import BookingStatus
from services import concierge_booking_service


def _payload() -> AdminConciergeCreateBookingRequest:
    return AdminConciergeCreateBookingRequest(
        customer_id="customer-1",
        place_id="place-1",
        cleaner_id="cleaner-1",
        schedule=int(time.time()) + 7200,
        extras={"add_ons": []},
        service="STANDARD",
        duration={"hours": 2, "minutes": 0},
        custom_details=None,
    )


@pytest.mark.asyncio
async def test_create_concierge_booking_maps_payload_and_creates_records(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = _payload()

    async def _stub_create_booking_by_admin_for_customer(*, payload):
        assert payload.customer_id == "customer-1"
        assert payload.cleaner_id == "cleaner-1"
        return SimpleNamespace(id="booking-1", status=BookingStatus.REQUESTED)

    async def _stub_create_concierge_booking(record):
        assert record.admin_id == "admin-1"
        assert record.customer_id == "customer-1"
        assert record.booking_id == "booking-1"
        assert record.note == "VIP concierge"
        assert record.status == BookingStatus.REQUESTED
        return SimpleNamespace(id="concierge-1", booking_id="booking-1", status=BookingStatus.REQUESTED)

    async def _stub_retrieve_cleaner_by_id(*, id: str):
        assert id == "cleaner-1"
        return SimpleNamespace(id=id, allow_admin_selection=True)

    monkeypatch.setattr(concierge_booking_service, "retrieve_cleaner_by_id", _stub_retrieve_cleaner_by_id)
    monkeypatch.setattr(concierge_booking_service, "create_booking_by_admin_for_customer", _stub_create_booking_by_admin_for_customer)
    monkeypatch.setattr(concierge_booking_service, "create_concierge_booking", _stub_create_concierge_booking)

    booking, concierge_record = await concierge_booking_service.create_concierge_booking_for_admin(
        admin_id="admin-1",
        payload=payload,
        note="VIP concierge",
    )

    assert booking.id == "booking-1"
    assert concierge_record.id == "concierge-1"


@pytest.mark.asyncio
async def test_create_concierge_booking_rejects_cleaner_without_admin_selection_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _payload()

    async def _stub_retrieve_cleaner_by_id(*, id: str):
        return SimpleNamespace(id=id, allow_admin_selection=False)

    async def _stub_create_booking_by_admin_for_customer(*, payload):
        _ = payload
        raise AssertionError("Booking creation should not run when cleaner is not selectable")

    monkeypatch.setattr(concierge_booking_service, "retrieve_cleaner_by_id", _stub_retrieve_cleaner_by_id)
    monkeypatch.setattr(concierge_booking_service, "create_booking_by_admin_for_customer", _stub_create_booking_by_admin_for_customer)

    with pytest.raises(HTTPException) as exc_info:
        await concierge_booking_service.create_concierge_booking_for_admin(
            admin_id="admin-1",
            payload=payload,
            note="VIP concierge",
        )
    assert exc_info.value.status_code == 422
