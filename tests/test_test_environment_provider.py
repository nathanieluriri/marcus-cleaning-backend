from __future__ import annotations

import pytest

from core.errors import AppException, ErrorCode
from core.payments.test_environment_provider import FakePaymentProvider
from core.payments.types import PaymentIntentRequest, PaymentStatus


class _InsertResult:
    def __init__(self, acknowledged: bool) -> None:
        self.acknowledged = acknowledged


class _Collection:
    def __init__(self) -> None:
        self._rows: dict[str, dict] = {}

    async def find_one(self, filter_dict: dict):
        reference = filter_dict.get("reference")
        return self._rows.get(reference) # type: ignore

    async def insert_one(self, payload: dict):
        self._rows[payload["reference"]] = payload
        return _InsertResult(acknowledged=True)

    async def update_one(self, filter_dict: dict, update_dict: dict):
        reference = filter_dict["reference"]
        row = self._rows.get(reference)
        if row is None:
            return None
        row.update(update_dict.get("$set", {}))
        return None


class _DB:
    def __init__(self) -> None:
        self.test_payment_intent = _Collection()


@pytest.mark.asyncio
async def test_create_intent_persists_and_returns_checkout_url(monkeypatch: pytest.MonkeyPatch):
    fake_db = _DB()
    monkeypatch.setattr("core.payments.test_environment_provider.db", fake_db)
    provider = FakePaymentProvider(base_url="http://localhost:8000", webhook_secret_hash="hash")

    intent = await provider.create_intent(
        PaymentIntentRequest(
            amount_minor=129900,
            currency="usd",
            reference="ref-100",
            customer_email="user@example.com",
            metadata={"title": "Deep clean"},
        )
    )

    assert intent.reference == "ref-100"
    assert intent.status == PaymentStatus.PENDING
    assert intent.checkout_url == "http://localhost:8000/web/payments/link/ref-100"
    stored = await fake_db.test_payment_intent.find_one({"reference": "ref-100"})
    assert stored is not None
    assert stored["provider"] == "test"


@pytest.mark.asyncio
async def test_verify_webhook_rejects_invalid_signature():
    provider = FakePaymentProvider(base_url="http://localhost:8000", webhook_secret_hash="expected")

    with pytest.raises(AppException) as exc_info:
        await provider.verify_webhook(
            body=b'{"reference":"ref-200","status":"successful"}',
            headers={"verif-hash": "wrong"},
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["code"] == ErrorCode.PAYMENT_WEBHOOK_INVALID.value # type: ignore


@pytest.mark.asyncio
async def test_fetch_transaction_maps_status(monkeypatch: pytest.MonkeyPatch):
    fake_db = _DB()
    fake_db.test_payment_intent._rows["ref-300"] = {
        "reference": "ref-300",
        "status": "successful",
        "amount_minor": 5000,
        "currency": "USD",
        "metadata": {},
        "provider": "test",
    }
    monkeypatch.setattr("core.payments.test_environment_provider.db", fake_db)
    provider = FakePaymentProvider(base_url="http://localhost:8000")

    tx = await provider.fetch_transaction(reference="ref-300")

    assert tx.reference == "ref-300"
    assert tx.status == PaymentStatus.SUCCEEDED
    assert tx.raw["status"] == PaymentStatus.SUCCEEDED.value


@pytest.mark.asyncio
async def test_refund_marks_intent_refunded(monkeypatch: pytest.MonkeyPatch):
    fake_db = _DB()
    fake_db.test_payment_intent._rows["ref-400"] = {
        "reference": "ref-400",
        "status": "pending",
        "amount_minor": 20000,
        "currency": "USD",
        "metadata": {},
        "provider": "test",
    }
    monkeypatch.setattr("core.payments.test_environment_provider.db", fake_db)
    provider = FakePaymentProvider(base_url="http://localhost:8000")

    tx = await provider.refund(reference="ref-400", amount_minor=12000)

    assert tx.status == PaymentStatus.REFUNDED
    stored = await fake_db.test_payment_intent.find_one({"reference": "ref-400"})
    assert stored is not None
    assert stored["status"] == PaymentStatus.REFUNDED.value
    assert stored["refunded_amount_minor"] == 12000
