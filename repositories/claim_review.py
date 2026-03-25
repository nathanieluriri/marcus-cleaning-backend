from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.claim_review import ClaimReviewCreate, ClaimReviewOut, ClaimReviewUpdate


def _collection():
    return db.claim_reviews


async def create_claim_review(payload: ClaimReviewCreate) -> ClaimReviewOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return ClaimReviewOut(**row)


async def get_claim_review(filter_dict: dict) -> Optional[ClaimReviewOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return ClaimReviewOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch claim_review: {err}") from err


async def get_claim_reviews(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[ClaimReviewOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[ClaimReviewOut] = []
    async for row in cursor:
        items.append(ClaimReviewOut(**row))
    return items


async def update_claim_review(filter_dict: dict, payload: ClaimReviewUpdate) -> ClaimReviewOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return ClaimReviewOut(**row)


async def delete_claim_review(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
