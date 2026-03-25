from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.dynamic_pricing_rule import DynamicPricingRuleBase, DynamicPricingRuleCreate, DynamicPricingRuleUpdate
from services.dynamic_pricing_rule_service import (
    add_dynamic_pricing_rule,
    remove_dynamic_pricing_rule,
    retrieve_dynamic_pricing_rule_by_id,
    retrieve_dynamic_pricing_rules,
    update_dynamic_pricing_rule_by_id,
)

router = APIRouter(prefix="/pricing-rules", tags=["Admin Dynamic Pricing"])


@router.get("/")
@document_response(message="DynamicPricingRule list fetched successfully", success_example=[])
async def list_dynamic_pricing_rules(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=100, gt=0, le=500),
    filters: str | None = Query(default=None),
):
    parsed_filters: dict = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filters JSON") from err
    return await retrieve_dynamic_pricing_rules(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="DynamicPricingRule fetched successfully")
async def get_dynamic_pricing_rule(id: str = Path(..., description="Resource identifier")):
    return await retrieve_dynamic_pricing_rule_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="DynamicPricingRule created successfully", status_code=status.HTTP_201_CREATED)
async def create_dynamic_pricing_rule(payload: DynamicPricingRuleBase):
    return await add_dynamic_pricing_rule(DynamicPricingRuleCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="DynamicPricingRule updated successfully")
async def patch_dynamic_pricing_rule(id: str, payload: DynamicPricingRuleUpdate):
    return await update_dynamic_pricing_rule_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="DynamicPricingRule deleted successfully")
async def delete_dynamic_pricing_rule(id: str):
    await remove_dynamic_pricing_rule(id=id)
    return None
