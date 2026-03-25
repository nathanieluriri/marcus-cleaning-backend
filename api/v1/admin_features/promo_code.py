from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.promo_code import PromoCodeBase, PromoCodeCreate, PromoCodeUpdate
from services.promo_code_service import (
    add_promo_code,
    remove_promo_code,
    retrieve_promo_code_by_id,
    retrieve_promo_codes,
    update_promo_code_by_id,
)

router = APIRouter(prefix="/promo-codes", tags=["Admin Promo Codes"])


@router.get("/")
@document_response(message="PromoCode list fetched successfully", success_example=[])
async def list_promo_codes(
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
    return await retrieve_promo_codes(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="PromoCode fetched successfully")
async def get_promo_code(id: str = Path(..., description="Resource identifier")):
    return await retrieve_promo_code_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="PromoCode created successfully", status_code=status.HTTP_201_CREATED)
async def create_promo_code(payload: PromoCodeBase):
    return await add_promo_code(PromoCodeCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="PromoCode updated successfully")
async def patch_promo_code(id: str, payload: PromoCodeUpdate):
    return await update_promo_code_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="PromoCode deleted successfully")
async def delete_promo_code(id: str):
    await remove_promo_code(id=id)
    return None
