from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from schemas.customer_app_contract import CustomerProfileEditRequestContract
from services import customer_app_contract_service


def _customer(**overrides):
    payload = {
        "id": "customer-123",
        "firstName": "Old",
        "lastName": "Name",
        "email": "tester@example.com",
        "phoneNumber": None,
        "avatarDocumentId": None,
        "date_created": 100,
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


@pytest.mark.asyncio
async def test_update_customer_profile_contract_updates_fields(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        assert id == "customer-123"
        return _customer()

    async def _stub_get_document_by_id(*, document_id: str):
        assert document_id == "doc-1"
        return SimpleNamespace(owner_id="customer-123", object_key="avatars/doc-1")

    async def _stub_update_user_by_id(*, user_id: str, user_data, is_password_getting_changed: bool = False):
        _ = is_password_getting_changed
        assert user_id == "customer-123"
        assert user_data.firstName == "Marcus"
        assert user_data.lastName == "Dashi"
        assert user_data.phoneNumber == "+2348012345678"
        assert user_data.avatarDocumentId == "doc-1"
        return _customer(
            firstName="Marcus",
            lastName="Dashi",
            phoneNumber="+2348012345678",
            avatarDocumentId="doc-1",
        )

    async def _stub_resolve_avatar_url(_avatar_document_id: str | None):
        return "https://cdn.example.com/avatar.jpg"

    monkeypatch.setattr(customer_app_contract_service, "retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(customer_app_contract_service, "get_document_by_id", _stub_get_document_by_id)
    monkeypatch.setattr(customer_app_contract_service, "update_user_by_id", _stub_update_user_by_id)
    monkeypatch.setattr(customer_app_contract_service, "_resolve_avatar_url", _stub_resolve_avatar_url)

    result = await customer_app_contract_service.update_customer_profile_contract(
        customer_id="customer-123",
        payload=CustomerProfileEditRequestContract(
            fullName="Marcus Dashi",
            phoneNumber="+2348012345678",
            avatarDocumentId="doc-1",
        ),
    )

    assert result.id == "customer-123"
    assert result.fullName == "Marcus Dashi"
    assert result.phoneNumber == "+2348012345678"
    assert result.avatarDocumentId == "doc-1"
    assert result.avatarUrl == "https://cdn.example.com/avatar.jpg"


@pytest.mark.asyncio
async def test_update_customer_profile_contract_rejects_foreign_avatar(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        return _customer(id=id)

    async def _stub_get_document_by_id(*, document_id: str):
        assert document_id == "doc-foreign"
        return SimpleNamespace(owner_id="customer-999", object_key="avatars/doc-foreign")

    monkeypatch.setattr(customer_app_contract_service, "retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(customer_app_contract_service, "get_document_by_id", _stub_get_document_by_id)

    with pytest.raises(HTTPException) as exc_info:
        await customer_app_contract_service.update_customer_profile_contract(
            customer_id="customer-123",
            payload=CustomerProfileEditRequestContract(
                avatarDocumentId="doc-foreign",
            ),
        )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_update_customer_profile_contract_allows_null_clear(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_user_by_user_id(*, id: str):
        return _customer(
            id=id,
            firstName="Marcus",
            lastName="Dashi",
            phoneNumber="+2348012345678",
            avatarDocumentId="doc-1",
        )

    async def _stub_update_user_by_id(*, user_id: str, user_data, is_password_getting_changed: bool = False):
        _ = is_password_getting_changed
        assert user_id == "customer-123"
        assert user_data.phoneNumber is None
        assert user_data.avatarDocumentId is None
        return _customer(
            id=user_id,
            firstName="Marcus",
            lastName="Dashi",
            phoneNumber=None,
            avatarDocumentId=None,
        )

    async def _stub_resolve_avatar_url(_avatar_document_id: str | None):
        return None

    monkeypatch.setattr(customer_app_contract_service, "retrieve_user_by_user_id", _stub_retrieve_user_by_user_id)
    monkeypatch.setattr(customer_app_contract_service, "update_user_by_id", _stub_update_user_by_id)
    monkeypatch.setattr(customer_app_contract_service, "_resolve_avatar_url", _stub_resolve_avatar_url)

    result = await customer_app_contract_service.update_customer_profile_contract(
        customer_id="customer-123",
        payload=CustomerProfileEditRequestContract(
            phoneNumber=None,
            avatarDocumentId=None,
        ),
    )

    assert result.phoneNumber is None
    assert result.avatarDocumentId is None
    assert result.avatarUrl is None
