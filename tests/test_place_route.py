from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import place_route
from schemas.autocomplete_search_result import AutocompleteSearchResultOut
from schemas.place import PlaceOut
from security.auth import verify_any_token
from security.principal import AuthPrincipal


def _principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="user-123",
        role="customer",
        access_token_id="access-123",
        jwt_token="jwt-123",
    )


def _build_app(with_auth_override: bool = True) -> FastAPI:
    app = FastAPI()
    app.include_router(place_route.router, prefix="/v1")
    if with_auth_override:
        app.dependency_overrides[verify_any_token] = _principal
    return app


def test_allowed_countries_route_returns_response_envelope(monkeypatch):
    async def _stub_get_allowed_countries():
        return ["NG", "GH"]

    monkeypatch.setattr(place_route, "get_allowed_countries", _stub_get_allowed_countries)
    client = TestClient(_build_app())

    response = client.get("/v1/places/allowed-countries")
    assert response.status_code == 200

    payload = response.json()
    assert payload["success"] is True
    assert payload["message"] == "Allowed countries fetched successfully"
    assert payload["data"] == ["NG", "GH"]


def test_autocomplete_route_returns_enriched_places(monkeypatch):
    async def _stub_get_autocomplete(input_text: str, country: str | None = None):
        assert input_text == "Lekki"
        assert country == "NG"
        return [
            PlaceOut(
                place_id="pid-1",
                name="Lekki",
                formatted_address="Lekki, Lagos",
                longitude=3.52,
                latitude=6.44,
                description="Lekki, Lagos",
            )
        ]

    monkeypatch.setattr(place_route, "get_autocomplete", _stub_get_autocomplete)
    client = TestClient(_build_app())

    response = client.get("/v1/places/autocomplete", params={"input": "Lekki", "country": "NG"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["place_id"] == "pid-1"
    assert payload["data"][0]["latitude"] == 6.44


def test_autocomplete_route_requires_auth():
    client = TestClient(_build_app(with_auth_override=False))
    response = client.get("/v1/places/autocomplete", params={"input": "Lekki", "country": "NG"})
    assert response.status_code == 403


def test_details_route_requires_place_id_query_param():
    client = TestClient(_build_app())
    response = client.get("/v1/places/details")
    assert response.status_code == 422


def test_details_route_requires_auth():
    client = TestClient(_build_app(with_auth_override=False))
    response = client.get("/v1/places/details", params={"place_id": "pid-1"})
    assert response.status_code == 403


def test_save_search_results_route_uses_principal_user_id(monkeypatch):
    async def _stub_save_search_result_for_principal(*, principal: AuthPrincipal, search_input: str, place: PlaceOut):
        assert principal.user_id == "user-123"
        assert search_input == "Lekki"
        assert place.place_id == "pid-1"
        return AutocompleteSearchResultOut(
            id="sr-1",
            search_input="Lekki",
            user_id=principal.user_id,
            place=place,
            date_created=100,
            last_updated=100,
        )

    monkeypatch.setattr(place_route, "save_search_result_for_principal", _stub_save_search_result_for_principal)
    client = TestClient(_build_app())

    response = client.post(
        "/v1/places/search-results",
        json={
            "search_input": "Lekki",
            "place": {
                "place_id": "pid-1",
                "name": "Lekki",
                "formatted_address": "Lekki, Lagos",
                "longitude": 3.52,
                "latitude": 6.44,
                "description": "Lekki, Lagos",
            },
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["user_id"] == "user-123"


def test_list_search_results_route_returns_only_user_history(monkeypatch):
    async def _stub_list_search_results_for_principal(*, principal: AuthPrincipal, start: int = 0, stop: int = 100):
        assert principal.user_id == "user-123"
        assert start == 0
        assert stop == 20
        return [
            AutocompleteSearchResultOut(
                id="sr-1",
                search_input="Lekki",
                user_id=principal.user_id,
                place=PlaceOut(
                    place_id="pid-1",
                    name="Lekki",
                    formatted_address="Lekki, Lagos",
                    longitude=3.52,
                    latitude=6.44,
                    description="Lekki, Lagos",
                ),
                date_created=100,
                last_updated=100,
            )
        ]

    monkeypatch.setattr(place_route, "list_search_results_for_principal", _stub_list_search_results_for_principal)
    client = TestClient(_build_app())

    response = client.get("/v1/places/search-results")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["user_id"] == "user-123"


def test_reverse_geocode_route_returns_place(monkeypatch):
    async def _stub_get_reverse_geocode(lat: float, lng: float, country: str | None = None):
        assert lat == 6.5244
        assert lng == 3.3792
        assert country == "NG"
        return PlaceOut(
            place_id="pid-r1",
            name="Victoria Island",
            formatted_address="Victoria Island, Lagos",
            longitude=3.3792,
            latitude=6.5244,
            description="Victoria Island, Lagos",
        )

    monkeypatch.setattr(place_route, "get_reverse_geocode", _stub_get_reverse_geocode)
    client = TestClient(_build_app())

    response = client.get("/v1/places/reverse-geocode", params={"lat": 6.5244, "lng": 3.3792, "country": "NG"})
    assert response.status_code == 200

    payload = response.json()
    assert payload["success"] is True
    assert payload["message"] == "Reverse geocode completed successfully"
    assert payload["data"]["place_id"] == "pid-r1"
