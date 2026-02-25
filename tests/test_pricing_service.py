from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.errors import AppException, ErrorCode
from schemas.booking import BookingOut
from schemas.imports import (
    AddOn,
    BookingStatus,
    CleaningScopeItem,
    CleaningServices,
    CustomServiceDetails,
    Duration,
    Extra,
    PropertyType,
)
from schemas.place import PlaceOut
from services import pricing_service


def _make_booking(**overrides) -> BookingOut:
    payload = {
        "id": "booking-1",
        "customer_id": "customer-1",
        "place_id": "place-1",
        "cleaner_id": "cleaner-1",
        "extras": Extra(add_ons=[]),
        "service": CleaningServices.STANDARD,
        "duration": Duration(hours=2, minutes=0),
        "custom_details": None,
        "status": BookingStatus.REQUESTED,
    }
    payload.update(overrides)
    return BookingOut(**payload)


@pytest.mark.asyncio
async def test_calculate_quote_standard_service_with_addon(monkeypatch: pytest.MonkeyPatch):
    booking = _make_booking(extras=Extra(add_ons=[AddOn.LAUNDRY]))

    async def _stub_resolve_place(place_id: str) -> PlaceOut:
        assert place_id == "place-1"
        return PlaceOut(
            place_id="place-1",
            name="Lekki",
            formatted_address="Lekki, Lagos",
            longitude=3.4,
            latitude=6.4,
            country_code="NG",
        )

    monkeypatch.setattr(pricing_service, "_resolve_place", _stub_resolve_place)

    quote = await pricing_service.calculate_quote_for_booking(booking=booking)

    assert quote.currency == "NGN"
    assert quote.amount_minor == 11500
    assert quote.breakdown["base_service_amount"] == 9000
    assert quote.breakdown["addons_amount"] == 2500
    assert quote.breakdown["custom_modifiers_amount"] == 0


@pytest.mark.asyncio
async def test_calculate_quote_custom_service_rules(monkeypatch: pytest.MonkeyPatch):
    booking = _make_booking(
        service=CleaningServices.CUSTOM,
        duration=Duration(hours=1, minutes=30),
        extras=Extra(add_ons=[AddOn.WINDOWS]),
        custom_details=CustomServiceDetails(
            property_type=PropertyType.APARTMENT,
            square_meters=100,
            bedrooms=2,
            bathrooms=1,
            cleaning_scope=[CleaningScopeItem.KITCHEN, CleaningScopeItem.BATHROOM],
        ),
    )

    async def _stub_resolve_place(place_id: str) -> PlaceOut:
        assert place_id == "place-1"
        return PlaceOut(
            place_id="place-1",
            name="Lekki",
            formatted_address="Lekki, Lagos",
            longitude=3.4,
            latitude=6.4,
            country_code="NG",
        )

    monkeypatch.setattr(pricing_service, "_resolve_place", _stub_resolve_place)

    quote = await pricing_service.calculate_quote_for_booking(booking=booking)

    assert quote.currency == "NGN"
    assert quote.amount_minor == 23800
    assert quote.breakdown["base_service_amount"] == 7500
    assert quote.breakdown["addons_amount"] == 3000
    assert quote.breakdown["custom_modifiers_amount"] == 13300


@pytest.mark.asyncio
async def test_calculate_quote_rejects_unsupported_country(monkeypatch: pytest.MonkeyPatch):
    booking = _make_booking()

    async def _stub_resolve_place(place_id: str) -> PlaceOut:
        return PlaceOut(
            place_id=place_id,
            name="Accra",
            formatted_address="Accra",
            longitude=0.1,
            latitude=5.6,
            country_code="GH",
        )

    monkeypatch.setattr(pricing_service, "_resolve_place", _stub_resolve_place)

    with pytest.raises(AppException) as exc_info:
        await pricing_service.calculate_quote_for_booking(booking=booking)

    exc = exc_info.value
    assert exc.status_code == 422
    assert exc.detail["code"] == ErrorCode.VALIDATION_FAILED.value
