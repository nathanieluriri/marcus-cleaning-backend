from __future__ import annotations

import time

from bson import ObjectId
from pymongo import ReturnDocument

from core.database import db
from schemas.payment_schema import PaymentTransactionCreate, PaymentTransactionOut, WebhookReplayCreate

_PAYMENT_INDEXES_READY = False


async def _ensure_payment_indexes() -> None:
    global _PAYMENT_INDEXES_READY
    if _PAYMENT_INDEXES_READY:
        return
    await db.payment_transactions.create_index(
        "reference",
        name="idx_payment_reference_unique",
        unique=True,
    )
    await db.payment_transactions.create_index(
        "booking_id",
        name="idx_payment_booking_id_unique",
        unique=True,
        sparse=True,
    )
    await db.payment_transactions.create_index("owner_id", name="idx_payment_owner_id")
    await db.payment_transactions.create_index("status", name="idx_payment_status")
    await db.payment_webhook_events.create_index(
        [("provider", 1), ("event_id", 1)],
        name="idx_payment_webhook_provider_event_unique",
        unique=True,
    )
    _PAYMENT_INDEXES_READY = True


async def create_payment_transaction(payload: PaymentTransactionCreate) -> PaymentTransactionOut:
    await _ensure_payment_indexes()
    result = await db.payment_transactions.insert_one(payload.model_dump())
    stored = await db.payment_transactions.find_one({"_id": result.inserted_id})
    return PaymentTransactionOut(**stored) # type: ignore


async def get_payment_transaction_by_reference(reference: str) -> PaymentTransactionOut | None:
    await _ensure_payment_indexes()
    row = await db.payment_transactions.find_one({"reference": reference})
    if row is None:
        return None
    return PaymentTransactionOut(**row)


async def get_payment_transaction_by_booking_id(booking_id: str) -> PaymentTransactionOut | None:
    await _ensure_payment_indexes()
    row = await db.payment_transactions.find_one({"booking_id": booking_id})
    if row is None:
        return None
    return PaymentTransactionOut(**row)


async def list_pending_payment_transactions(limit: int) -> list[PaymentTransactionOut]:
    await _ensure_payment_indexes()
    capped_limit = max(limit, 0)
    if capped_limit == 0:
        return []
    items: list[PaymentTransactionOut] = []
    cursor = (
        db.payment_transactions.find({"status": "pending"})
        .sort("updated_at", 1)
        .limit(capped_limit)
    )
    async for row in cursor:
        items.append(PaymentTransactionOut(**row))
    return items


async def update_payment_transaction_status(reference: str, status: str, response_payload: dict) -> PaymentTransactionOut | None:
    await _ensure_payment_indexes()
    row = await db.payment_transactions.find_one_and_update(
        {"reference": reference},
        {"$set": {"status": status, "response_payload": response_payload, "updated_at": int(time.time())}},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return PaymentTransactionOut(**row)


async def get_payment_transaction_by_id(payment_id: str) -> PaymentTransactionOut | None:
    await _ensure_payment_indexes()
    if not ObjectId.is_valid(payment_id):
        return None
    row = await db.payment_transactions.find_one({"_id": ObjectId(payment_id)})
    if row is None:
        return None
    return PaymentTransactionOut(**row)


async def is_webhook_event_processed(provider: str, event_id: str) -> bool:
    await _ensure_payment_indexes()
    row = await db.payment_webhook_events.find_one({"provider": provider, "event_id": event_id})
    return row is not None


async def mark_webhook_event_processed(payload: WebhookReplayCreate) -> None:
    await _ensure_payment_indexes()
    await db.payment_webhook_events.insert_one(payload.model_dump())
