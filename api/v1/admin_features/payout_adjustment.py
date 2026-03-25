from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.payout_adjustment import PayoutAdjustmentBase, PayoutAdjustmentCreate, PayoutAdjustmentUpdate
from services.payout_adjustment_service import (
    add_payout_adjustment,
    remove_payout_adjustment,
    retrieve_payout_adjustment_by_id,
    retrieve_payout_adjustments,
    update_payout_adjustment_by_id,
)

router = APIRouter(prefix="/payout-adjustments", tags=["Admin Payout Adjustments"])


@router.get("/")
@document_response(message="PayoutAdjustment list fetched successfully", success_example=[])
async def list_payout_adjustments(
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
    return await retrieve_payout_adjustments(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="PayoutAdjustment fetched successfully")
async def get_payout_adjustment(id: str = Path(..., description="Resource identifier")):
    return await retrieve_payout_adjustment_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="PayoutAdjustment created successfully", status_code=status.HTTP_201_CREATED)
async def create_payout_adjustment(payload: PayoutAdjustmentBase):
    return await add_payout_adjustment(PayoutAdjustmentCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="PayoutAdjustment updated successfully")
async def patch_payout_adjustment(id: str, payload: PayoutAdjustmentUpdate):
    return await update_payout_adjustment_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="PayoutAdjustment deleted successfully")
async def delete_payout_adjustment(id: str):
    await remove_payout_adjustment(id=id)
    return None
