from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.payout_adjustment import create_payout_adjustment, delete_payout_adjustment, get_payout_adjustment, get_payout_adjustments, update_payout_adjustment
from schemas.payout_adjustment import PayoutAdjustmentCreate, PayoutAdjustmentOut, PayoutAdjustmentUpdate


async def add_payout_adjustment(payload: PayoutAdjustmentCreate) -> PayoutAdjustmentOut:
    return await create_payout_adjustment(payload)


async def retrieve_payout_adjustment_by_id(*, id: str) -> PayoutAdjustmentOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_payout_adjustment({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="PayoutAdjustment not found")
    return result


async def retrieve_payout_adjustments(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[PayoutAdjustmentOut]:
    return await get_payout_adjustments(filter_dict=filters or {}, start=start, stop=stop)


async def update_payout_adjustment_by_id(*, id: str, payload: PayoutAdjustmentUpdate) -> PayoutAdjustmentOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_payout_adjustment({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="PayoutAdjustment not found")
    return result


async def remove_payout_adjustment(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_payout_adjustment({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="PayoutAdjustment not found")
    return True
