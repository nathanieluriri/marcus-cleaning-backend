from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

from core.countries import ALLOWED_COUNTRIES
from core.errors import AppException, ErrorCode, resource_not_found
from core.redis_cache import cache_db
from schemas.place import PlaceOut

GOOGLE_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
GOOGLE_PLACE_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
GOOGLE_REVERSE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

PLACE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 15
AUTOCOMPLETE_MIN_CHARS = 2
PLACE_DETAILS_FIELDS = "place_id,name,formatted_address,geometry"
DETAILS_CONCURRENCY_LIMIT = 5


def _require_google_maps_api_key() -> str:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise AppException(
            status_code=503,
            code=ErrorCode.INTERNAL_ERROR,
            message="Google Maps API key is not configured",
        )
    return api_key


def _normalize_country(country: str | None) -> str | None:
    if country is None:
        return None

    normalized = country.strip().upper()
    if not normalized:
        return None

    if len(normalized) != 2 or not normalized.isalpha():
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Invalid country code",
            details={"field": "country", "expected": "ISO 3166-1 alpha-2"},
        )

    if ALLOWED_COUNTRIES and normalized not in ALLOWED_COUNTRIES:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Country is not allowed",
            details={"field": "country", "allowedCountries": list(ALLOWED_COUNTRIES)},
        )

    return normalized


def _normalize_input_text(input_text: str) -> str:
    normalized = " ".join(input_text.strip().split())
    if len(normalized) < AUTOCOMPLETE_MIN_CHARS:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message=f"Autocomplete input must be at least {AUTOCOMPLETE_MIN_CHARS} characters",
            details={"field": "input", "minimumLength": AUTOCOMPLETE_MIN_CHARS},
        )
    return normalized


def _validate_coordinates(lat: float, lng: float) -> None:
    if lat < -90 or lat > 90:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Latitude out of range",
            details={"field": "lat", "minimum": -90, "maximum": 90},
        )
    if lng < -180 or lng > 180:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Longitude out of range",
            details={"field": "lng", "minimum": -180, "maximum": 180},
        )


def _autocomplete_cache_key(*, input_text: str, country: str | None) -> str:
    normalized_country = country or "any"
    normalized_input = input_text.lower()
    return f"places:autocomplete:{normalized_country}:{normalized_input}"


def _details_cache_key(place_id: str) -> str:
    return f"places:details:{place_id}"


def _reverse_geocode_cache_key(*, lat: float, lng: float, country: str | None) -> str:
    normalized_country = country or "any"
    return f"places:reverse:{lat:.6f}:{lng:.6f}:{normalized_country}"


def _cache_get_json(cache_key: str) -> Any | None:
    try:
        raw = cache_db.get(cache_key)
    except Exception:
        return None

    if not raw:
        return None

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _cache_set_json(cache_key: str, payload: Any, ttl_seconds: int = PLACE_CACHE_TTL_SECONDS) -> None:
    try:
        cache_db.setex(cache_key, ttl_seconds, json.dumps(payload))
    except Exception:
        return


def _raise_provider_status_error(*, status_value: str, error_message: str | None = None) -> None:
    normalized_status = (status_value or "").upper()
    details: dict[str, Any] = {"providerStatus": normalized_status}
    if error_message:
        details["providerMessage"] = error_message

    if normalized_status == "INVALID_REQUEST":
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Invalid request to places provider",
            details=details,
        )
    if normalized_status == "OVER_QUERY_LIMIT":
        raise AppException(
            status_code=429,
            code=ErrorCode.TOO_MANY_REQUESTS,
            message="Places provider quota exceeded",
            details=details,
        )
    if normalized_status == "REQUEST_DENIED":
        raise AppException(
            status_code=403,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider denied the request",
            details=details,
        )

    raise AppException(
        status_code=502,
        code=ErrorCode.INTERNAL_ERROR,
        message="Places provider returned an unexpected status",
        details=details,
    )


async def _google_get_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    request_params = dict(params)
    request_params["key"] = _require_google_maps_api_key()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=request_params)
            response.raise_for_status()
    except httpx.HTTPStatusError as err:
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider HTTP error",
            details={"status_code": err.response.status_code},
        ) from err
    except httpx.HTTPError as err:
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider request failed",
            details=str(err),
        ) from err

    try:
        payload = response.json()
    except ValueError as err:
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider returned invalid JSON",
        ) from err

    if not isinstance(payload, dict):
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider response shape is invalid",
        )
    return payload


def _normalize_place_result(result: dict[str, Any], *, description: str | None = None) -> PlaceOut:
    place_id = str(result.get("place_id") or "").strip()
    if not place_id:
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider response missing place_id",
        )

    geometry = result.get("geometry")
    location = geometry.get("location") if isinstance(geometry, dict) else None
    if not isinstance(location, dict):
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider response missing coordinates",
            details={"place_id": place_id},
        )

    lat = location.get("lat")
    lng = location.get("lng")
    if lat is None or lng is None:
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider returned incomplete coordinates",
            details={"place_id": place_id},
        )

    name = str(result.get("name") or result.get("formatted_address") or place_id)
    formatted_address = str(result.get("formatted_address") or result.get("vicinity") or name)
    normalized_description = description or formatted_address

    return PlaceOut(
        place_id=place_id,
        name=name,
        formatted_address=formatted_address,
        longitude=float(lng),
        latitude=float(lat),
        description=normalized_description,
    )


async def get_allowed_countries() -> list[str]:
    return list(ALLOWED_COUNTRIES)


async def get_place_details(place_id: str) -> PlaceOut:
    normalized_place_id = place_id.strip()
    if not normalized_place_id:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="place_id is required",
            details={"field": "place_id"},
        )

    cache_key = _details_cache_key(normalized_place_id)
    cached = _cache_get_json(cache_key)
    if isinstance(cached, dict):
        try:
            return PlaceOut.model_validate(cached)
        except Exception:
            pass

    params: dict[str, Any] = {
        "place_id": normalized_place_id,
        "fields": PLACE_DETAILS_FIELDS,
    }

    payload = await _google_get_json(GOOGLE_PLACE_DETAILS_URL, params)
    status_value = str(payload.get("status") or "")
    if status_value.upper() in {"ZERO_RESULTS", "NOT_FOUND"}:
        raise resource_not_found("Place", normalized_place_id)
    if status_value.upper() != "OK":
        _raise_provider_status_error(
            status_value=status_value,
            error_message=payload.get("error_message"),
        )

    result = payload.get("result")
    if not isinstance(result, dict):
        raise AppException(
            status_code=502,
            code=ErrorCode.INTERNAL_ERROR,
            message="Places provider response missing result payload",
        )

    place = _normalize_place_result(result)
    _cache_set_json(cache_key, place.model_dump())
    return place


async def _enrich_prediction(
    prediction: dict[str, Any],
    *,
    semaphore: asyncio.Semaphore,
) -> PlaceOut:
    place_id = str(prediction.get("place_id") or "").strip()
    if not place_id:
        raise AppException(
            status_code=400,
            code=ErrorCode.VALIDATION_FAILED,
            message="Autocomplete prediction missing place_id",
        )

    description = prediction.get("description")
    async with semaphore:
        place = await get_place_details(place_id=place_id)

    if isinstance(description, str) and description.strip():
        return place.model_copy(update={"description": description.strip()})
    return place


async def get_autocomplete(
    input_text: str,
    country: str | None = None,
) -> list[PlaceOut]:
    normalized_input = _normalize_input_text(input_text=input_text)
    normalized_country = _normalize_country(country)

    cache_key = _autocomplete_cache_key(input_text=normalized_input, country=normalized_country)
    cached = _cache_get_json(cache_key)
    if isinstance(cached, list):
        try:
            return [PlaceOut.model_validate(item) for item in cached if isinstance(item, dict)]
        except Exception:
            pass

    params: dict[str, Any] = {"input": normalized_input}
    if normalized_country:
        params["components"] = f"country:{normalized_country.lower()}"

    payload = await _google_get_json(GOOGLE_AUTOCOMPLETE_URL, params)
    status_value = str(payload.get("status") or "")
    if status_value.upper() == "ZERO_RESULTS":
        return []
    if status_value.upper() != "OK":
        _raise_provider_status_error(
            status_value=status_value,
            error_message=payload.get("error_message"),
        )

    predictions = payload.get("predictions", [])
    if not isinstance(predictions, list) or not predictions:
        return []

    semaphore = asyncio.Semaphore(DETAILS_CONCURRENCY_LIMIT)
    tasks = [
        _enrich_prediction(prediction, semaphore=semaphore)
        for prediction in predictions
        if isinstance(prediction, dict)
    ]
    if not tasks:
        return []

    results = await asyncio.gather(*tasks, return_exceptions=True)
    places: list[PlaceOut] = []
    for item in results:
        if isinstance(item, Exception):
            if isinstance(item, AppException) and item.status_code in {400, 404}:
                continue
            raise item
        places.append(item) # type: ignore

    _cache_set_json(cache_key, [place.model_dump() for place in places])
    return places


async def get_reverse_geocode(lat: float, lng: float, country: str | None = None) -> PlaceOut:
    _validate_coordinates(lat=lat, lng=lng)
    normalized_country = _normalize_country(country)

    cache_key = _reverse_geocode_cache_key(lat=lat, lng=lng, country=normalized_country)
    cached = _cache_get_json(cache_key)
    if isinstance(cached, dict):
        try:
            return PlaceOut.model_validate(cached)
        except Exception:
            pass

    params: dict[str, Any] = {"latlng": f"{lat},{lng}"}
    if normalized_country:
        params["components"] = f"country:{normalized_country.lower()}"

    payload = await _google_get_json(GOOGLE_REVERSE_GEOCODE_URL, params)
    status_value = str(payload.get("status") or "")
    if status_value.upper() == "ZERO_RESULTS":
        raise resource_not_found("Place", f"{lat},{lng}")
    if status_value.upper() != "OK":
        _raise_provider_status_error(
            status_value=status_value,
            error_message=payload.get("error_message"),
        )

    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise resource_not_found("Place", f"{lat},{lng}")

    first = results[0]
    if not isinstance(first, dict):
        raise resource_not_found("Place", f"{lat},{lng}")

    place_id = str(first.get("place_id") or "").strip()
    if not place_id:
        raise resource_not_found("Place", f"{lat},{lng}")

    place = await get_place_details(place_id=place_id)
    formatted_address = first.get("formatted_address")
    if isinstance(formatted_address, str) and formatted_address.strip():
        place = place.model_copy(update={"description": formatted_address.strip()})

    _cache_set_json(cache_key, place.model_dump())
    return place
