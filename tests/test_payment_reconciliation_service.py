from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.payments.types import PaymentProviderName, PaymentStatus, PaymentTransaction
from schemas.payment_schema import PaymentTransactionOut
from services import payment_service


def _payment_out(*, payment_id: str, reference: str, provider: str = "test", status: str = "pending") -> PaymentTransactionOut:
    return PaymentTransactionOut(
        _id=payment_id,
        owner_id="customer-1",
        booking_id="booking-1",
        provider=provider,
        reference=reference,
        status=status,
        amount_minor=11_500,
        currency="NGN",
        response_payload={"provider_reference": reference},
        idempotency_key=f"{provider}:{reference}",
        created_at=100,
        updated_at=100,
    )


@pytest.mark.asyncio
async def test_reconcile_payment_transaction_updates_status(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_payment_transaction_by_id(*, payment_id: str):
        assert payment_id == "payment-1"
        return _payment_out(payment_id=payment_id, reference="ref-1", provider="test", status="pending")

    async def _stub_update_payment_transaction_status(*, reference: str, status: str, response_payload: dict):
        assert reference == "ref-1"
        assert status == "succeeded"
        assert response_payload["status"] == "succeeded"
        return _payment_out(payment_id="payment-1", reference="ref-1", status=status)

    class _Provider:
        async def fetch_transaction(self, *, reference: str) -> PaymentTransaction:
            assert reference == "ref-1"
            return PaymentTransaction(
                provider=PaymentProviderName.TEST,
                reference=reference,
                status=PaymentStatus.SUCCEEDED,
                raw={"status": "succeeded"},
            )

    manager = SimpleNamespace(get_provider=lambda provider_name: _Provider())

    monkeypatch.setattr(payment_service, "get_payment_transaction_by_id", _stub_get_payment_transaction_by_id)
    monkeypatch.setattr(payment_service, "update_payment_transaction_status", _stub_update_payment_transaction_status)
    monkeypatch.setattr(payment_service, "_get_payment_manager", lambda: manager)

    updated = await payment_service.reconcile_payment_transaction(payment_id="payment-1")

    assert updated.status == "succeeded"


@pytest.mark.asyncio
async def test_reconcile_pending_payments_continues_on_failure(monkeypatch: pytest.MonkeyPatch):
    async def _stub_list_pending_payment_transactions(*, limit: int):
        assert limit == 2
        return [
            _payment_out(payment_id="payment-1", reference="ref-1"),
            _payment_out(payment_id="payment-2", reference="ref-2"),
        ]

    async def _stub_reconcile_payment_transaction(*, payment_id: str):
        if payment_id == "payment-2":
            raise RuntimeError("provider timeout")
        return _payment_out(payment_id=payment_id, reference="ref-1", status="succeeded")

    monkeypatch.setattr(payment_service, "list_pending_payment_transactions", _stub_list_pending_payment_transactions)
    monkeypatch.setattr(payment_service, "reconcile_payment_transaction", _stub_reconcile_payment_transaction)

    summary = await payment_service.reconcile_pending_payments(limit=2)

    assert summary == {
        "checked": 2,
        "updated": 1,
        "failed": 1,
    }
