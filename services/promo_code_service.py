from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.promo_code import create_promo_code, delete_promo_code, get_promo_code, get_promo_codes, update_promo_code
from schemas.promo_code import PromoCodeCreate, PromoCodeOut, PromoCodeUpdate


async def add_promo_code(payload: PromoCodeCreate) -> PromoCodeOut:
    return await create_promo_code(payload)


async def retrieve_promo_code_by_id(*, id: str) -> PromoCodeOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_promo_code({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="PromoCode not found")
    return result


async def retrieve_promo_codes(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[PromoCodeOut]:
    return await get_promo_codes(filter_dict=filters or {}, start=start, stop=stop)


async def update_promo_code_by_id(*, id: str, payload: PromoCodeUpdate) -> PromoCodeOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_promo_code({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="PromoCode not found")
    return result


async def remove_promo_code(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_promo_code({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="PromoCode not found")
    return True
