from __future__ import annotations

import json

import pytest

from core.errors import AppException, ErrorCode
from services import place_service


class _FakeCache:
    def __init__(self) -> None:
        self._rows: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._rows.get(key)

    def setex(self, key: str, _: int, value: str) -> None:
        self._rows[key] = value


def _place_details_payload(*, place_id: str, lat: float = 6.5, lng: float = 3.3):
    return {
        "status": "OK",
        "result": {
            "place_id": place_id,
            "name": "Test Place",
            "formatted_address": "Test Address",
            "geometry": {"location": {"lat": lat, "lng": lng}},
        },
    }


@pytest.mark.asyncio
async def test_get_allowed_countries_returns_constant(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(place_service, "ALLOWED_COUNTRIES", ("NG", "GH"))
    countries = await place_service.get_allowed_countries()
    assert countries == ["NG", "GH"]


@pytest.mark.asyncio
async def test_get_autocomplete_uses_cache_before_provider(monkeypatch: pytest.MonkeyPatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr(place_service, "cache_db", fake_cache)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")

    cache_key = place_service._autocomplete_cache_key(input_text="Lagos", country="NG")
    fake_cache._rows[cache_key] = json.dumps(
        [
            {
                "place_id": "pid-1",
                "name": "Lekki",
                "formatted_address": "Lekki, Lagos",
                "longitude": 3.5,
                "latitude": 6.4,
                "description": "Lekki, Lagos",
            }
        ]
    )

    async def _stub_google_get_json(url: str, params: dict):  # pragma: no cover
        raise AssertionError(f"Provider should not be called for cached result: {url} {params}")

    monkeypatch.setattr(place_service, "_google_get_json", _stub_google_get_json)

    result = await place_service.get_autocomplete(input_text="Lagos", country="NG")
    assert len(result) == 1
    assert result[0].place_id == "pid-1"


@pytest.mark.asyncio
async def test_get_autocomplete_cache_miss_fetches_and_caches(monkeypatch: pytest.MonkeyPatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr(place_service, "cache_db", fake_cache)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")
    monkeypatch.setattr(place_service, "ALLOWED_COUNTRIES", ("NG",))

    async def _stub_google_get_json(url: str, params: dict):
        if url == place_service.GOOGLE_AUTOCOMPLETE_URL:
            assert params["input"] == "Lekki"
            assert params["components"] == "country:ng"
            return {
                "status": "OK",
                "predictions": [
                    {"place_id": "pid-1", "description": "Lekki, Lagos"},
                ],
            }
        if url == place_service.GOOGLE_PLACE_DETAILS_URL:
            return _place_details_payload(place_id=params["place_id"], lat=6.44, lng=3.52)
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr(place_service, "_google_get_json", _stub_google_get_json)

    result = await place_service.get_autocomplete(input_text="Lekki", country="NG")
    assert len(result) == 1
    assert result[0].place_id == "pid-1"
    assert result[0].description == "Lekki, Lagos"

    cache_key = place_service._autocomplete_cache_key(input_text="Lekki", country="NG")
    assert cache_key in fake_cache._rows


@pytest.mark.asyncio
async def test_get_autocomplete_zero_results_returns_empty_list(monkeypatch: pytest.MonkeyPatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr(place_service, "cache_db", fake_cache)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")

    async def _stub_google_get_json(url: str, params: dict):
        assert url == place_service.GOOGLE_AUTOCOMPLETE_URL
        return {"status": "ZERO_RESULTS", "predictions": []}

    monkeypatch.setattr(place_service, "_google_get_json", _stub_google_get_json)

    result = await place_service.get_autocomplete(input_text="zzzz", country=None)
    assert result == []


@pytest.mark.asyncio
async def test_get_autocomplete_rejects_short_input():
    with pytest.raises(AppException) as exc_info:
        await place_service.get_autocomplete(input_text="a")

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.detail["code"] == ErrorCode.VALIDATION_FAILED.value


@pytest.mark.asyncio
async def test_get_reverse_geocode_rejects_out_of_range_coordinates():
    with pytest.raises(AppException) as exc_info:
        await place_service.get_reverse_geocode(lat=90.1, lng=10.0)

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.detail["code"] == ErrorCode.VALIDATION_FAILED.value


@pytest.mark.asyncio
async def test_get_reverse_geocode_zero_results_returns_not_found(monkeypatch: pytest.MonkeyPatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr(place_service, "cache_db", fake_cache)
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-key")

    async def _stub_google_get_json(url: str, params: dict):
        assert url == place_service.GOOGLE_REVERSE_GEOCODE_URL
        return {"status": "ZERO_RESULTS", "results": []}

    monkeypatch.setattr(place_service, "_google_get_json", _stub_google_get_json)

    with pytest.raises(AppException) as exc_info:
        await place_service.get_reverse_geocode(lat=6.5, lng=3.3)

    exc = exc_info.value
    assert exc.status_code == 404
    assert exc.detail["code"] == ErrorCode.RESOURCE_NOT_FOUND.value


@pytest.mark.asyncio
async def test_get_reverse_geocode_cache_hit_skips_provider(monkeypatch: pytest.MonkeyPatch):
    fake_cache = _FakeCache()
    monkeypatch.setattr(place_service, "cache_db", fake_cache)

    cache_key = place_service._reverse_geocode_cache_key(lat=6.5244, lng=3.3792, country="NG")
    fake_cache._rows[cache_key] = json.dumps(
        {
            "place_id": "pid-r1",
            "name": "Cached Place",
            "formatted_address": "Cached Address",
            "longitude": 3.3792,
            "latitude": 6.5244,
            "description": "Cached Address",
        }
    )

    async def _stub_google_get_json(url: str, params: dict):  # pragma: no cover
        raise AssertionError(f"Provider should not be called for cached result: {url} {params}")

    monkeypatch.setattr(place_service, "_google_get_json", _stub_google_get_json)

    result = await place_service.get_reverse_geocode(lat=6.5244, lng=3.3792, country="NG")
    assert result.place_id == "pid-r1"
