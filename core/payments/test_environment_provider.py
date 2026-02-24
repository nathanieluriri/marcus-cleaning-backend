from __future__ import annotations

import json
import time
from typing import Any

from core.database import db
from core.errors import AppException, ErrorCode, resource_not_found
from core.payments.provider import PaymentProvider
from core.payments.types import (
    PaymentIntentRequest,
    PaymentIntentResponse,
    PaymentProviderName,
    PaymentStatus,
    PaymentTransaction,
    WebhookEvent,
)


def _epoch() -> int:
    return int(time.time())


class FakePaymentProvider(PaymentProvider):
    provider_name = PaymentProviderName.TEST.value

    def __init__(self, *, base_url: str, webhook_secret_hash: str | None = None) -> None:
        self._webhook_secret_hash = webhook_secret_hash
        self._base_url = base_url.rstrip("/")

    @staticmethod
    def _normalize_status(raw_status: Any) -> PaymentStatus:
        value = str(raw_status or "").strip().lower()
        if value in {"success", "successful", "succeeded"}:
            return PaymentStatus.SUCCEEDED
        if value == "failed":
            return PaymentStatus.FAILED
        if value == "refunded":
            return PaymentStatus.REFUNDED
        return PaymentStatus.PENDING

    def _build_checkout_url(self, reference: str) -> str:
        return f"{self._base_url}/web/payments/link/{reference}"

    async def _find_intent(self, *, reference: str) -> dict[str, Any]:
        row = await db.test_payment_intent.find_one({"reference": reference})
        if row is None:
            raise resource_not_found("TestPaymentIntent", reference)
        return row

    async def create_intent(self, payload: PaymentIntentRequest) -> PaymentIntentResponse:
        now = _epoch()
        document: dict[str, Any] = {
            "reference": payload.reference,
            "amount_minor": payload.amount_minor,
            "currency": payload.currency.upper(),
            "customer_email": payload.customer_email,
            "metadata": payload.metadata or {},
            "status": PaymentStatus.PENDING.value,
            "provider": self.provider_name,
            "created_at": now,
            "updated_at": now,
        }
        checkout_url = self._build_checkout_url(payload.reference)

        existing = await db.test_payment_intent.find_one({"reference": payload.reference})
        if existing is None:
            result = await db.test_payment_intent.insert_one(document)
            if not result.acknowledged:
                raise AppException(
                    status_code=502,
                    code=ErrorCode.PAYMENT_PROVIDER_ERROR,
                    message="Test provider intent creation failed",
                    details={"reference": payload.reference},
                )
        else:
            await db.test_payment_intent.update_one(
                {"reference": payload.reference},
                {"$set": {"updated_at": now, "metadata": payload.metadata or existing.get("metadata") or {}}},
            )

        provider_payload = {
            "reference": payload.reference,
            "currency": payload.currency.upper(),
            "amount_minor": payload.amount_minor,
            "checkout_url": checkout_url,
            "status": PaymentStatus.PENDING.value,
            "provider": self.provider_name,
            "metadata": payload.metadata or {},
        }
        return PaymentIntentResponse(
            provider=PaymentProviderName.TEST,
            reference=payload.reference,
            status=PaymentStatus.PENDING,
            checkout_url=checkout_url,
            provider_payload=provider_payload,
        )

    async def verify_webhook(self, *, body: bytes, headers: dict[str, str]) -> WebhookEvent:
        provided = headers.get("verif-hash") or headers.get("Verif-Hash")
        expected = self._webhook_secret_hash
        if expected and provided != expected:
            raise AppException(
                status_code=401,
                code=ErrorCode.PAYMENT_WEBHOOK_INVALID,
                message="Invalid test provider webhook signature",
            )

        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            raise AppException(
                status_code=400,
                code=ErrorCode.PAYMENT_WEBHOOK_INVALID,
                message="Invalid webhook payload",
                details=str(err),
            ) from err

        reference = (
            payload.get("reference")
            or payload.get("tx_ref")
            or payload.get("data", {}).get("reference")
            or payload.get("data", {}).get("tx_ref")
        )
        event_id = str(payload.get("id") or payload.get("event_id") or reference or "unknown")
        event_type = str(payload.get("event") or payload.get("type") or payload.get("status") or "unknown")
        return WebhookEvent(
            provider=PaymentProviderName.TEST,
            event_id=event_id,
            event_type=event_type,
            payload=payload,
        )

    async def fetch_transaction(self, *, reference: str) -> PaymentTransaction:
        row = await self._find_intent(reference=reference)
        status = self._normalize_status(row.get("status"))
        raw = {
            "reference": row.get("reference", reference),
            "status": status.value,
            "amount_minor": row.get("amount_minor"),
            "currency": row.get("currency"),
            "metadata": row.get("metadata", {}),
            "provider": row.get("provider", self.provider_name),
        }
        return PaymentTransaction(
            provider=PaymentProviderName.TEST,
            reference=reference,
            status=status,
            raw=raw,
        )

    async def refund(self, *, reference: str, amount_minor: int | None = None) -> PaymentTransaction:
        row = await self._find_intent(reference=reference)
        now = _epoch()
        refund_payload = {
            "status": PaymentStatus.REFUNDED.value,
            "updated_at": now,
            "refunded_amount_minor": amount_minor if amount_minor is not None else row.get("amount_minor"),
            "refund_requested_amount_minor": amount_minor,
        }
        await db.test_payment_intent.update_one(
            {"reference": reference},
            {"$set": refund_payload},
        )
        raw = {
            "reference": reference,
            "status": PaymentStatus.REFUNDED.value,
            "amount_minor": row.get("amount_minor"),
            "currency": row.get("currency"),
            "refunded_amount_minor": refund_payload["refunded_amount_minor"],
            "provider": self.provider_name,
        }
        return PaymentTransaction(
            provider=PaymentProviderName.TEST,
            reference=reference,
            status=PaymentStatus.REFUNDED,
            raw=raw,
        )
