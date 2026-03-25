from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.dynamic_pricing_rule import create_dynamic_pricing_rule, delete_dynamic_pricing_rule, get_dynamic_pricing_rule, get_dynamic_pricing_rules, update_dynamic_pricing_rule
from schemas.dynamic_pricing_rule import DynamicPricingRuleCreate, DynamicPricingRuleOut, DynamicPricingRuleUpdate


async def add_dynamic_pricing_rule(payload: DynamicPricingRuleCreate) -> DynamicPricingRuleOut:
    return await create_dynamic_pricing_rule(payload)


async def retrieve_dynamic_pricing_rule_by_id(*, id: str) -> DynamicPricingRuleOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_dynamic_pricing_rule({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="DynamicPricingRule not found")
    return result


async def retrieve_dynamic_pricing_rules(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[DynamicPricingRuleOut]:
    return await get_dynamic_pricing_rules(filter_dict=filters or {}, start=start, stop=stop)


async def update_dynamic_pricing_rule_by_id(*, id: str, payload: DynamicPricingRuleUpdate) -> DynamicPricingRuleOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_dynamic_pricing_rule({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="DynamicPricingRule not found")
    return result


async def remove_dynamic_pricing_rule(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_dynamic_pricing_rule({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="DynamicPricingRule not found")
    return True
