from __future__ import annotations

from types import SimpleNamespace

import pytest

from schemas.place import PlaceOut
from schemas.saved_address import SavedAddressCreateRequest, SavedAddressOut
from services import saved_address_service


def _place() -> PlaceOut:
    return PlaceOut(
        place_id="pid-1",
        name="Lekki",
        formatted_address="Lekki, Lagos",
        longitude=3.52,
        latitude=6.44,
        description="Lekki, Lagos",
    )


def _saved_address(
    *,
    address_id: str,
    user_id: str = "customer-123",
    label: str = "Home",
    is_default: bool = False,
    date_created: int = 100,
    last_updated: int = 100,
) -> SavedAddressOut:
    return SavedAddressOut(
        id=address_id,
        user_id=user_id,
        label=label,
        addressLine="123 Urban St",
        place=_place(),
        isDefault=is_default,
        dateCreated=date_created,
        lastUpdated=last_updated,
    )


@pytest.mark.asyncio
async def test_create_my_saved_address_sets_first_as_default(monkeypatch: pytest.MonkeyPatch):
    async def _stub_list_saved_addresses_for_user(*, user_id: str, start: int = 0, stop: int = 100):
        assert user_id == "customer-123"
        assert start == 0
        assert stop == 1
        return []

    async def _stub_clear_default_for_user(*, user_id: str):
        assert user_id == "customer-123"

    async def _stub_create_saved_address(payload):
        assert payload.isDefault is True
        return _saved_address(address_id="addr-1", is_default=True)

    monkeypatch.setattr(saved_address_service, "list_saved_addresses_for_user", _stub_list_saved_addresses_for_user)
    monkeypatch.setattr(saved_address_service, "clear_default_for_user", _stub_clear_default_for_user)
    monkeypatch.setattr(saved_address_service, "create_saved_address", _stub_create_saved_address)

    result = await saved_address_service.create_my_saved_address(
        user_id="customer-123",
        payload=SavedAddressCreateRequest(
            label="Home",
            addressLine="123 Urban St",
            place=_place(),
        ),
    )
    assert result.isDefault is True


@pytest.mark.asyncio
async def test_set_default_saved_address_switches_default(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_saved_address_by_id_for_user(*, address_id: str, user_id: str):
        assert address_id == "addr-2"
        assert user_id == "customer-123"
        return _saved_address(address_id=address_id, is_default=False)

    async def _stub_clear_default_for_user(*, user_id: str):
        assert user_id == "customer-123"

    async def _stub_mark_saved_address_as_default_for_user(*, address_id: str, user_id: str, last_updated: int):
        assert address_id == "addr-2"
        assert user_id == "customer-123"
        assert isinstance(last_updated, int)
        return _saved_address(address_id=address_id, is_default=True, last_updated=last_updated)

    monkeypatch.setattr(saved_address_service, "get_saved_address_by_id_for_user", _stub_get_saved_address_by_id_for_user)
    monkeypatch.setattr(saved_address_service, "clear_default_for_user", _stub_clear_default_for_user)
    monkeypatch.setattr(saved_address_service, "mark_saved_address_as_default_for_user", _stub_mark_saved_address_as_default_for_user)

    result = await saved_address_service.set_default_saved_address(
        user_id="customer-123",
        address_id="addr-2",
    )
    assert result.isDefault is True


@pytest.mark.asyncio
async def test_delete_default_promotes_most_recent(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_saved_address_by_id_for_user(*, address_id: str, user_id: str):
        assert address_id == "addr-1"
        assert user_id == "customer-123"
        return _saved_address(address_id=address_id, is_default=True)

    async def _stub_delete_saved_address_for_user(*, address_id: str, user_id: str):
        assert address_id == "addr-1"
        assert user_id == "customer-123"
        return True

    async def _stub_get_most_recent_saved_address_for_user(*, user_id: str):
        assert user_id == "customer-123"
        return _saved_address(address_id="addr-2", is_default=False, last_updated=200)

    async def _stub_clear_default_for_user(*, user_id: str):
        assert user_id == "customer-123"

    promoted: dict[str, str] = {}

    async def _stub_mark_saved_address_as_default_for_user(*, address_id: str, user_id: str, last_updated: int):
        promoted["address_id"] = address_id
        promoted["user_id"] = user_id
        _ = last_updated
        return _saved_address(address_id=address_id, user_id=user_id, is_default=True)

    monkeypatch.setattr(saved_address_service, "get_saved_address_by_id_for_user", _stub_get_saved_address_by_id_for_user)
    monkeypatch.setattr(saved_address_service, "delete_saved_address_for_user", _stub_delete_saved_address_for_user)
    monkeypatch.setattr(saved_address_service, "get_most_recent_saved_address_for_user", _stub_get_most_recent_saved_address_for_user)
    monkeypatch.setattr(saved_address_service, "clear_default_for_user", _stub_clear_default_for_user)
    monkeypatch.setattr(saved_address_service, "mark_saved_address_as_default_for_user", _stub_mark_saved_address_as_default_for_user)

    result = await saved_address_service.delete_my_saved_address(
        user_id="customer-123",
        address_id="addr-1",
    )
    assert result["deleted"] is True
    assert promoted == {"address_id": "addr-2", "user_id": "customer-123"}
