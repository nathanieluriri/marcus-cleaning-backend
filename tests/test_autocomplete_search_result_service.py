from __future__ import annotations

import pytest

from schemas.autocomplete_search_result import AutocompleteSearchResultOut
from schemas.place import PlaceOut
from security.principal import AuthPrincipal
from services import autocomplete_search_result_service


def _principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="user-123",
        role="customer",
        access_token_id="access-123",
        jwt_token="jwt-123",
    )


def _place() -> PlaceOut:
    return PlaceOut(
        place_id="pid-1",
        name="Lekki",
        formatted_address="Lekki, Lagos",
        longitude=3.52,
        latitude=6.44,
        description="Lekki, Lagos",
    )


@pytest.mark.asyncio
async def test_save_search_result_for_principal_sets_user_id_from_token(monkeypatch: pytest.MonkeyPatch):
    async def _stub_create(payload):
        assert payload.user_id == "user-123"
        return AutocompleteSearchResultOut(
            id="sr-1",
            search_input=payload.search_input,
            user_id=payload.user_id,
            place=payload.place,
            date_created=100,
            last_updated=100,
        )

    monkeypatch.setattr(autocomplete_search_result_service, "create_autocomplete_search_result", _stub_create)

    saved = await autocomplete_search_result_service.save_search_result_for_principal(
        principal=_principal(),
        search_input="Lekki",
        place=_place(),
    )
    assert saved.user_id == "user-123"
    assert saved.search_input == "Lekki"


@pytest.mark.asyncio
async def test_list_search_results_for_principal_filters_by_user_id(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_many(filter_dict: dict, start: int = 0, stop: int = 100):
        assert filter_dict == {"user_id": "user-123"}
        assert start == 10
        assert stop == 20
        return [
            AutocompleteSearchResultOut(
                id="sr-1",
                search_input="Lekki",
                user_id="user-123",
                place=_place(),
                date_created=100,
                last_updated=100,
            )
        ]

    monkeypatch.setattr(autocomplete_search_result_service, "get_autocomplete_search_results", _stub_get_many)

    rows = await autocomplete_search_result_service.list_search_results_for_principal(
        principal=_principal(),
        start=10,
        stop=20,
    )
    assert len(rows) == 1
    assert rows[0].user_id == "user-123"
