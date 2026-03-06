from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from time import monotonic

from fastapi import status

from core.countries import COUNTRY_CURRENCY_MAP
from core.database import db
from core.errors import AppException, ErrorCode, resource_not_found
from core.pricing_rules import (
    ADDON_PRICE_MINOR,
    BASE_SERVICE_HOURLY_MINOR,
    CUSTOM_BATHROOM_RATE_MINOR,
    CUSTOM_BEDROOM_RATE_MINOR,
    CUSTOM_PROPERTY_MULTIPLIER,
    CUSTOM_SCOPE_PRICE_MINOR,
    CUSTOM_SQUARE_METER_RATE_MINOR,
)
from repositories.booking_repo import get_booking_by_id
from schemas.booking import BookingOut
from schemas.imports import CleaningServices
from schemas.place import PlaceOut
from services.place_service import get_place_details

PLACE_RESOLUTION_CACHE_TTL_SECONDS = 60
PLACE_RESOLUTION_CACHE_MAX_ITEMS = 256
SUPPORTED_COUNTRY_CODES = tuple(COUNTRY_CURRENCY_MAP.keys())


@dataclass(frozen=True)
class BookingPriceQuote:
    booking_id: str
    customer_id: str
    cleaner_id: str
    place_id: str
    currency: str
    amount_minor: int
    breakdown: dict


@dataclass(frozen=True)
class _CachedPlace:
    place: PlaceOut
    expires_at: float


_place_resolution_cache: dict[str, _CachedPlace] = {}


def _currency_for_country(country_code: str) -> str:
    currency = COUNTRY_CURRENCY_MAP.get(country_code.upper())
    if currency is None:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Unsupported country for pricing",
            details={"country_code": country_code, "supported": list(SUPPORTED_COUNTRY_CODES)},
        )
    return currency


def _get_cached_place(place_id: str) -> PlaceOut | None:
    cached = _place_resolution_cache.get(place_id)
    if cached is None:
        return None
    if monotonic() >= cached.expires_at:
        _place_resolution_cache.pop(place_id, None)
        return None
    return cached.place


def _set_cached_place(place_id: str, place: PlaceOut) -> None:
    if len(_place_resolution_cache) >= PLACE_RESOLUTION_CACHE_MAX_ITEMS:
        now = monotonic()
        expired_keys = [key for key, value in _place_resolution_cache.items() if now >= value.expires_at]
        for key in expired_keys:
            _place_resolution_cache.pop(key, None)
        if len(_place_resolution_cache) >= PLACE_RESOLUTION_CACHE_MAX_ITEMS:
            oldest_key = min(
                _place_resolution_cache,
                key=lambda key: _place_resolution_cache[key].expires_at,
            )
            _place_resolution_cache.pop(oldest_key, None)

    _place_resolution_cache[place_id] = _CachedPlace(
        place=place,
        expires_at=monotonic() + PLACE_RESOLUTION_CACHE_TTL_SECONDS,
    )


async def _resolve_place(place_id: str) -> PlaceOut:
    row = await db.autocomplete_search_results.find_one({"place.place_id": place_id})
    if row and isinstance(row, dict) and isinstance(row.get("place"), dict):
        place = PlaceOut.model_validate(row["place"])
        if place.country_code:
            return place

    place = await get_place_details(place_id=place_id)
    if not place.country_code:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Unable to infer place country for pricing",
            details={"place_id": place_id},
        )
    return place


async def _resolve_place_with_cache(place_id: str) -> PlaceOut:
    cached_place = _get_cached_place(place_id)
    if cached_place is not None:
        return cached_place

    place = await _resolve_place(place_id=place_id)
    if place.country_code:
        _set_cached_place(place_id, place)
    return place


def _custom_modifier_amount(booking: BookingOut) -> int:
    if booking.service != CleaningServices.CUSTOM:
        return 0
    custom = booking.custom_details
    if custom is None:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="custom_details is required for custom service pricing",
        )

    raw_amount = (
        ceil(custom.square_meters * CUSTOM_SQUARE_METER_RATE_MINOR)
        + (custom.bedrooms * CUSTOM_BEDROOM_RATE_MINOR)
        + (custom.bathrooms * CUSTOM_BATHROOM_RATE_MINOR)
        + sum(CUSTOM_SCOPE_PRICE_MINOR[item] for item in custom.cleaning_scope)
    )
    multiplier = CUSTOM_PROPERTY_MULTIPLIER[custom.property_type]
    return int(round(raw_amount * multiplier))


async def calculate_quote_for_booking_id(booking_id: str) -> BookingPriceQuote:
    booking = await get_booking_by_id(booking_id)
    if booking is None:
        raise resource_not_found("Booking", booking_id)
    return await calculate_quote_for_booking(booking=booking)


async def calculate_quote_for_booking(*, booking: BookingOut) -> BookingPriceQuote:
    place = await _resolve_place_with_cache(place_id=booking.place_id)
    if not place.country_code:
        raise AppException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            code=ErrorCode.VALIDATION_FAILED,
            message="Place is missing country_code for currency selection",
            details={"place_id": booking.place_id},
        )

    currency = _currency_for_country(place.country_code)
    duration_hours = max(1.0, booking.duration.to_hours())
    base_hourly = BASE_SERVICE_HOURLY_MINOR[booking.service]
    base_service_amount = ceil(base_hourly * duration_hours)
    addon_amount = sum(ADDON_PRICE_MINOR[item] for item in booking.extras.add_ons)
    custom_amount = _custom_modifier_amount(booking)
    subtotal = base_service_amount + addon_amount + custom_amount
    total = subtotal

    breakdown = {
        "base_service_amount": base_service_amount,
        "addons_amount": addon_amount,
        "custom_modifiers_amount": custom_amount,
        "subtotal_amount": subtotal,
        "total_amount": total,
        "currency": currency,
        "duration_hours": duration_hours,
        "service": booking.service.value,
        "addons": [addon.value for addon in booking.extras.add_ons],
        "place_country_code": place.country_code,
    }

    return BookingPriceQuote(
        booking_id=str(booking.id or ""),
        customer_id=booking.customer_id,
        cleaner_id=booking.cleaner_id,
        place_id=booking.place_id,
        currency=currency,
        amount_minor=total,
        breakdown=breakdown,
    )
