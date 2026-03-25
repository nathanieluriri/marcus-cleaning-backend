from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.payout_adjustment import PayoutAdjustmentCreate, PayoutAdjustmentOut, PayoutAdjustmentUpdate


def _collection():
    return db.payout_adjustments


async def create_payout_adjustment(payload: PayoutAdjustmentCreate) -> PayoutAdjustmentOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return PayoutAdjustmentOut(**row)


async def get_payout_adjustment(filter_dict: dict) -> Optional[PayoutAdjustmentOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return PayoutAdjustmentOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch payout_adjustment: {err}") from err


async def get_payout_adjustments(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[PayoutAdjustmentOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[PayoutAdjustmentOut] = []
    async for row in cursor:
        items.append(PayoutAdjustmentOut(**row))
    return items


async def update_payout_adjustment(filter_dict: dict, payload: PayoutAdjustmentUpdate) -> PayoutAdjustmentOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return PayoutAdjustmentOut(**row)


async def delete_payout_adjustment(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
