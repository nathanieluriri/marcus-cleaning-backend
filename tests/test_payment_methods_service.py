from __future__ import annotations

import pytest

from schemas.payment_schema import PaymentMethodCreateIn, PaymentMethodOut
from services import payment_service


def _payment_method(
    *,
    method_id: str,
    owner_id: str = "customer-1",
    is_default: bool = False,
    updated_at: int = 100,
) -> PaymentMethodOut:
    return PaymentMethodOut(
        _id=method_id,
        owner_id=owner_id,
        provider="flutterwave",
        provider_method_ref=f"pm_ref_{method_id}",
        type="card",
        label="Personal",
        brand="visa",
        last4="1234",
        exp_month=12,
        exp_year=2030,
        bank_name=None,
        is_default=is_default,
        status="active",
        created_at=100,
        updated_at=updated_at,
    )


@pytest.mark.asyncio
async def test_add_payment_method_sets_first_as_default(monkeypatch: pytest.MonkeyPatch):
    async def _stub_list_payment_methods(*, owner_id: str, start: int = 0, stop: int = 100):
        assert owner_id == "customer-1"
        assert start == 0
        assert stop == 1
        return []

    async def _stub_clear_default_payment_method(*, owner_id: str):
        assert owner_id == "customer-1"

    async def _stub_create_payment_method(payload):
        assert payload.is_default is True
        return _payment_method(method_id="method-1", is_default=True)

    monkeypatch.setattr(payment_service, "list_payment_methods", _stub_list_payment_methods)
    monkeypatch.setattr(payment_service, "clear_default_payment_method", _stub_clear_default_payment_method)
    monkeypatch.setattr(payment_service, "create_payment_method", _stub_create_payment_method)

    result = await payment_service.add_payment_method_for_owner(
        owner_id="customer-1",
        payload=PaymentMethodCreateIn(
            provider="flutterwave",
            provider_method_ref="pm_ref_1",
            type="card",
        ),
    )

    assert result.is_default is True


@pytest.mark.asyncio
async def test_set_default_payment_method_switches_default(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_payment_method_by_id(*, method_id: str, owner_id: str):
        assert method_id == "method-2"
        assert owner_id == "customer-1"
        return _payment_method(method_id=method_id, owner_id=owner_id, is_default=False)

    async def _stub_clear_default_payment_method(*, owner_id: str):
        assert owner_id == "customer-1"

    async def _stub_mark_payment_method_default(*, method_id: str, owner_id: str, updated_at: int):
        assert method_id == "method-2"
        assert owner_id == "customer-1"
        assert isinstance(updated_at, int)
        return _payment_method(method_id=method_id, owner_id=owner_id, is_default=True, updated_at=updated_at)

    monkeypatch.setattr(payment_service, "get_payment_method_by_id", _stub_get_payment_method_by_id)
    monkeypatch.setattr(payment_service, "clear_default_payment_method", _stub_clear_default_payment_method)
    monkeypatch.setattr(payment_service, "mark_payment_method_default", _stub_mark_payment_method_default)

    updated = await payment_service.set_default_payment_method_for_owner(
        owner_id="customer-1",
        method_id="method-2",
    )

    assert updated.is_default is True


@pytest.mark.asyncio
async def test_delete_default_method_promotes_most_recent(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_payment_method_by_id(*, method_id: str, owner_id: str):
        assert method_id == "method-1"
        assert owner_id == "customer-1"
        return _payment_method(method_id=method_id, owner_id=owner_id, is_default=True)

    async def _stub_delete_payment_method(*, method_id: str, owner_id: str):
        assert method_id == "method-1"
        assert owner_id == "customer-1"
        return True

    async def _stub_get_most_recent_payment_method(*, owner_id: str):
        assert owner_id == "customer-1"
        return _payment_method(method_id="method-2", owner_id=owner_id, is_default=False, updated_at=200)

    async def _stub_clear_default_payment_method(*, owner_id: str):
        assert owner_id == "customer-1"

    promoted: dict[str, str] = {}

    async def _stub_mark_payment_method_default(*, method_id: str, owner_id: str, updated_at: int):
        _ = updated_at
        promoted["method_id"] = method_id
        promoted["owner_id"] = owner_id
        return _payment_method(method_id=method_id, owner_id=owner_id, is_default=True)

    monkeypatch.setattr(payment_service, "get_payment_method_by_id", _stub_get_payment_method_by_id)
    monkeypatch.setattr(payment_service, "delete_payment_method", _stub_delete_payment_method)
    monkeypatch.setattr(payment_service, "get_most_recent_payment_method", _stub_get_most_recent_payment_method)
    monkeypatch.setattr(payment_service, "clear_default_payment_method", _stub_clear_default_payment_method)
    monkeypatch.setattr(payment_service, "mark_payment_method_default", _stub_mark_payment_method_default)

    result = await payment_service.delete_payment_method_for_owner(
        owner_id="customer-1",
        method_id="method-1",
    )

    assert result["deleted"] is True
    assert promoted == {"method_id": "method-2", "owner_id": "customer-1"}
