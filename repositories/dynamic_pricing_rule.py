from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.dynamic_pricing_rule import DynamicPricingRuleCreate, DynamicPricingRuleOut, DynamicPricingRuleUpdate


def _collection():
    return db.dynamic_pricing_rules


async def create_dynamic_pricing_rule(payload: DynamicPricingRuleCreate) -> DynamicPricingRuleOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return DynamicPricingRuleOut(**row)


async def get_dynamic_pricing_rule(filter_dict: dict) -> Optional[DynamicPricingRuleOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return DynamicPricingRuleOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch dynamic_pricing_rule: {err}") from err


async def get_dynamic_pricing_rules(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[DynamicPricingRuleOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[DynamicPricingRuleOut] = []
    async for row in cursor:
        items.append(DynamicPricingRuleOut(**row))
    return items


async def update_dynamic_pricing_rule(filter_dict: dict, payload: DynamicPricingRuleUpdate) -> DynamicPricingRuleOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return DynamicPricingRuleOut(**row)


async def delete_dynamic_pricing_rule(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
