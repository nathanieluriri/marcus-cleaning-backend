from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field

from core.response_envelope import document_response
from schemas.admin_schema import AdminOut
from schemas.claim_review import ClaimReviewBase, ClaimReviewCreate, ClaimReviewUpdate
from security.account_status_check import check_admin_account_status_and_permissions
from services.claim_review_service import (
    add_claim_review,
    decide_claim_review,
    remove_claim_review,
    retrieve_claim_review_by_id,
    retrieve_claim_reviews,
    update_claim_review_by_id,
)

router = APIRouter(prefix="/claim-reviews", tags=["Admin Claim Reviews"])


class ClaimDecisionIn(BaseModel):
    decision: str = Field(min_length=2, max_length=40)
    decision_note: str | None = None


@router.get("/")
@document_response(message="ClaimReview list fetched successfully", success_example=[])
async def list_claim_reviews(
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
    return await retrieve_claim_reviews(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ClaimReview fetched successfully")
async def get_claim_review(id: str = Path(..., description="Resource identifier")):
    return await retrieve_claim_review_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ClaimReview created successfully", status_code=status.HTTP_201_CREATED)
async def create_claim_review(payload: ClaimReviewBase):
    return await add_claim_review(ClaimReviewCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="ClaimReview updated successfully")
async def patch_claim_review(id: str, payload: ClaimReviewUpdate):
    return await update_claim_review_by_id(id=id, payload=payload)


@router.post("/{id}/decision")
@document_response(message="Claim review decision recorded successfully")
async def decide_claim(
    id: str,
    payload: ClaimDecisionIn,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await decide_claim_review(
        id=id,
        decision=payload.decision,
        decision_note=payload.decision_note,
        admin_id=admin.id or "",
    )


@router.delete("/{id}")
@document_response(message="ClaimReview deleted successfully")
async def delete_claim_review(id: str):
    await remove_claim_review(id=id)
    return None
