# ============================================================================
# REVIEW SERVICE
# ============================================================================
# This file was auto-generated on: 2026-02-24 11:47:26 WAT
# It contains  asynchrounous functions that make use of the repo functions 
# 
# ============================================================================

from bson import ObjectId
from fastapi import HTTPException
from typing import List

from repositories.review import (
    create_review,
    get_review,
    get_reviews,
    review_summary_aggregation,
    update_review,
    delete_review,
)
from schemas.review import ReviewCreate, ReviewRatingSummary, ReviewUpdate, ReviewOut


async def add_review(review_data: ReviewCreate) -> ReviewOut:
    """adds an entry of ReviewCreate to the database and returns an object

    Returns:
        _type_: ReviewOut
    """
    return await create_review(review_data)


async def remove_review(review_id: str):
    """deletes a field from the database and removes ReviewCreateobject 

    Raises:
        HTTPException 400: Invalid review ID format
        HTTPException 404:  Review not found
    """
    if not ObjectId.is_valid(review_id):
        raise HTTPException(status_code=400, detail="Invalid review ID format")

    filter_dict = {"_id": ObjectId(review_id)}
    result = await delete_review(filter_dict)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")

    else: return True
    
async def retrieve_review_by_review_id(id: str) -> ReviewOut:
    """Retrieves review object based specific Id 

    Raises:
        HTTPException 404(not found): if  Review not found in the db
        HTTPException 400(bad request): if  Invalid review ID format

    Returns:
        _type_: ReviewOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid review ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_review(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="Review not found")

    return result


async def retrieve_reviews(filters: dict | None = None, start: int = 0, stop: int = 100) -> List[ReviewOut]:
    """Retrieves ReviewOut Objects in a list

    Returns:
        _type_: ReviewOut
    """
    return await get_reviews(filter_dict=filters or {}, start=start, stop=stop)



async def retrieve_reviews_summary(cleaner_id:str) -> ReviewRatingSummary:
    """Retrieves ReviewRatingSummary Objects in a list 
    
    Args:
        cleaner_id (str): the user id for a user in the cleaner role

    Returns:
        _type_: ReviewRatingSummary
    """
    
    return await review_summary_aggregation(cleaner_id=cleaner_id)


async def update_review_by_id(id: str, data: ReviewUpdate) -> ReviewOut:
    """updates an entry of review in the database

    Raises:
        HTTPException 404(not found): if Review not found or update failed
        HTTPException 400(not found): Invalid review ID format

    Returns:
        _type_: ReviewOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid review ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await update_review(filter_dict, data)

    if not result:
        raise HTTPException(status_code=404, detail="Review not found or update failed")

    return result