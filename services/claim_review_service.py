from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.claim_review import create_claim_review, delete_claim_review, get_claim_review, get_claim_reviews, update_claim_review
from schemas.claim_review import ClaimReviewCreate, ClaimReviewOut, ClaimReviewUpdate


async def add_claim_review(payload: ClaimReviewCreate) -> ClaimReviewOut:
    return await create_claim_review(payload)


async def retrieve_claim_review_by_id(*, id: str) -> ClaimReviewOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_claim_review({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ClaimReview not found")
    return result


async def retrieve_claim_reviews(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ClaimReviewOut]:
    return await get_claim_reviews(filter_dict=filters or {}, start=start, stop=stop)


async def update_claim_review_by_id(*, id: str, payload: ClaimReviewUpdate) -> ClaimReviewOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_claim_review({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="ClaimReview not found")
    return result


async def remove_claim_review(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_claim_review({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ClaimReview not found")
    return True


async def decide_claim_review(
    *,
    id: str,
    decision: str,
    decision_note: str | None,
    admin_id: str,
) -> ClaimReviewOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_claim_review(
        {"_id": ObjectId(id)},
        ClaimReviewUpdate(
            decision=decision,
            decision_note=decision_note,
            decided_by_admin_id=admin_id,
        ),
    )
    if result is None:
        raise HTTPException(status_code=404, detail="ClaimReview not found")
    return result
