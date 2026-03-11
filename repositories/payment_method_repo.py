from __future__ import annotations

from bson import ObjectId
from pymongo import DESCENDING, ReturnDocument

from core.database import db
from schemas.payment_schema import PaymentMethodCreate, PaymentMethodOut, PaymentMethodUpdate

_PAYMENT_METHOD_INDEXES_READY = False


async def _ensure_payment_method_indexes() -> None:
    global _PAYMENT_METHOD_INDEXES_READY
    if _PAYMENT_METHOD_INDEXES_READY:
        return
    await db.payment_methods.create_index("owner_id", name="idx_payment_method_owner_id")
    await db.payment_methods.create_index(
        [("owner_id", 1), ("is_default", 1)],
        name="idx_payment_method_owner_default_unique",
        unique=True,
        partialFilterExpression={"is_default": True},
    )
    await db.payment_methods.create_index(
        [("owner_id", 1), ("provider", 1), ("provider_method_ref", 1)],
        name="idx_payment_method_provider_ref_unique",
        unique=True,
    )
    _PAYMENT_METHOD_INDEXES_READY = True


async def create_payment_method(payload: PaymentMethodCreate) -> PaymentMethodOut:
    await _ensure_payment_method_indexes()
    result = await db.payment_methods.insert_one(payload.model_dump())
    stored = await db.payment_methods.find_one({"_id": result.inserted_id})
    return PaymentMethodOut(**stored)  # type: ignore[arg-type]


async def list_payment_methods(*, owner_id: str, start: int = 0, stop: int = 100) -> list[PaymentMethodOut]:
    await _ensure_payment_method_indexes()
    cursor = (
        db.payment_methods.find({"owner_id": owner_id})
        .sort([("is_default", DESCENDING), ("updated_at", DESCENDING), ("created_at", DESCENDING)])
        .skip(start)
        .limit(max(0, stop - start))
    )
    items: list[PaymentMethodOut] = []
    async for row in cursor:
        items.append(PaymentMethodOut(**row))
    return items


async def get_payment_method_by_id(*, method_id: str, owner_id: str) -> PaymentMethodOut | None:
    await _ensure_payment_method_indexes()
    if not ObjectId.is_valid(method_id):
        return None
    row = await db.payment_methods.find_one({"_id": ObjectId(method_id), "owner_id": owner_id})
    if row is None:
        return None
    return PaymentMethodOut(**row)


async def update_payment_method(
    *,
    method_id: str,
    owner_id: str,
    payload: PaymentMethodUpdate,
) -> PaymentMethodOut | None:
    await _ensure_payment_method_indexes()
    if not ObjectId.is_valid(method_id):
        return None
    update_dict = payload.model_dump(exclude_none=True)
    if not update_dict:
        return await get_payment_method_by_id(method_id=method_id, owner_id=owner_id)
    row = await db.payment_methods.find_one_and_update(
        {"_id": ObjectId(method_id), "owner_id": owner_id},
        {"$set": update_dict},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return PaymentMethodOut(**row)


async def delete_payment_method(*, method_id: str, owner_id: str) -> bool:
    await _ensure_payment_method_indexes()
    if not ObjectId.is_valid(method_id):
        return False
    result = await db.payment_methods.delete_one({"_id": ObjectId(method_id), "owner_id": owner_id})
    return bool(result.deleted_count)


async def clear_default_payment_method(*, owner_id: str) -> None:
    await _ensure_payment_method_indexes()
    await db.payment_methods.update_many(
        {"owner_id": owner_id, "is_default": True},
        {"$set": {"is_default": False}},
    )


async def mark_payment_method_default(*, method_id: str, owner_id: str, updated_at: int) -> PaymentMethodOut | None:
    await _ensure_payment_method_indexes()
    if not ObjectId.is_valid(method_id):
        return None
    row = await db.payment_methods.find_one_and_update(
        {"_id": ObjectId(method_id), "owner_id": owner_id},
        {"$set": {"is_default": True, "updated_at": updated_at}},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return PaymentMethodOut(**row)


async def get_most_recent_payment_method(*, owner_id: str) -> PaymentMethodOut | None:
    await _ensure_payment_method_indexes()
    row = await db.payment_methods.find_one(
        {"owner_id": owner_id},
        sort=[("updated_at", DESCENDING), ("created_at", DESCENDING), ("_id", DESCENDING)],
    )
    if row is None:
        return None
    return PaymentMethodOut(**row)
