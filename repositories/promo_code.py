from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.promo_code import PromoCodeCreate, PromoCodeOut, PromoCodeUpdate


def _collection():
    return db.promo_codes


async def create_promo_code(payload: PromoCodeCreate) -> PromoCodeOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return PromoCodeOut(**row)


async def get_promo_code(filter_dict: dict) -> Optional[PromoCodeOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return PromoCodeOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch promo_code: {err}") from err


async def get_promo_codes(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[PromoCodeOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[PromoCodeOut] = []
    async for row in cursor:
        items.append(PromoCodeOut(**row))
    return items


async def update_promo_code(filter_dict: dict, payload: PromoCodeUpdate) -> PromoCodeOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return PromoCodeOut(**row)


async def delete_promo_code(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
