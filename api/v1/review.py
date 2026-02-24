
from fastapi import APIRouter, Depends, HTTPException, Query, Path, status
from typing import Optional
import json
from core.response_envelope import document_response
from schemas.review import (
    ReviewCreate,
    ReviewOut,
    ReviewBase,
    ReviewUpdate,
)
from services.review_service import (
    add_review,
    remove_review,
    retrieve_reviews,
    retrieve_review_by_review_id,
    update_review_by_id,
)
from security.review_access_check import (
    ReviewAccessContext,
    require_review_create_access,
    require_review_delete_access,
    require_review_update_access,
)

router = APIRouter(prefix="/reviews", tags=["Reviews"])


# ------------------------------
# List Reviews (with pagination and filtering)
# ------------------------------
@router.get("/")
@document_response(
    message="Reviews fetched successfully",
    success_example=[],
)
async def list_reviews_for_a_cleaner(
    start: Optional[int] = Query(None, description="Start index for range-based pagination"),
    stop: Optional[int] = Query(None, description="Stop index for range-based pagination"),
    page_number: Optional[int] = Query(None, description="Page number for page-based pagination (0-indexed)"),
    # New: Filter parameter expects a JSON string
    filters: Optional[str] = Query(None, description="Optional JSON string of MongoDB filter criteria (e.g., '{\"field\": \"value\"}')")
):
    """
    Retrieves a list of Reviews with pagination and optional filtering.
    - Priority 1: Range-based (start/stop)
    - Priority 2: Page-based (page_number)
    - Priority 3: Default (first 100)
    """
    PAGE_SIZE = 50
    parsed_filters = {}

    # 1. Handle Filters
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid JSON format for 'filters' query parameter."
            )

    # 2. Determine Pagination
    # Case 1: Prefer start/stop if provided
    if start is not None or stop is not None:
        if start is None or stop is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both 'start' and 'stop' must be provided together.")
        if stop < start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'stop' cannot be less than 'start'.")
        
        # Pass filters to the service layer
        items = await retrieve_reviews(filters=parsed_filters, start=start, stop=stop)
        return items

    # Case 2: Use page_number if provided
    elif page_number is not None:
        if page_number < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'page_number' cannot be negative.")
        
        start_index = page_number * PAGE_SIZE
        stop_index = start_index + PAGE_SIZE
        # Pass filters to the service layer
        items = await retrieve_reviews(filters=parsed_filters, start=start_index, stop=stop_index)
        return items

    # Case 3: Default (no params)
    else:
        # Pass filters to the service layer
        items = await retrieve_reviews(filters=parsed_filters, start=0, stop=100)
        return items


# ------------------------------
# Retrieve a single Review
# ------------------------------
@router.get("/{id}")
@document_response(message="Review fetched successfully")
async def get_review_by_id(
    id: str = Path(..., description="review ID to fetch specific item")
):
    """
    Retrieves a single Review by its ID.
    """
    item = await retrieve_review_by_review_id(id=id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review not found")
    return item


# ------------------------------
# Create a new Review
# ------------------------------
# Uses ReviewBase for input (correctly)
@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(
    message="Review created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def create_review(
    payload: ReviewBase,
    access: ReviewAccessContext = Depends(require_review_create_access),
):
    """
    Creates a new Review.
    """
    # Creates ReviewCreate object which includes date_created/last_updated.
    new_data = ReviewCreate(
        **payload.model_dump(),
        customer_id=access.customer_id,
        booking_id=access.booking_id,
        cleaner_id=access.cleaner_id,
    )
    new_item = await add_review(new_data)
    if not new_item:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to create review")
    
    return new_item


# ------------------------------
# Update an existing Review
# ------------------------------
# Uses PATCH for partial update (correctly)
@router.patch("/{id}")
@document_response(message="Review updated successfully")
async def update_review(
    payload: ReviewUpdate ,
    id: str = Path(..., description="ID of the {db_name} to update"),
    _: ReviewAccessContext = Depends(require_review_update_access),
    
):
    """
    Updates an existing Review by its ID.
    Assumes the service layer handles partial updates (e.g., ignores None fields in payload).
    """
    updated_item = await update_review_by_id(id=id, data=payload)
    if not updated_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review not found or update failed")
    
    return updated_item


# ------------------------------
# Delete an existing Review
# ------------------------------
@router.delete("/{id}")
@document_response(message="Review deleted successfully")
async def delete_review(
    id: str = Path(..., description="ID of the review to delete"),
    _: ReviewAccessContext = Depends(require_review_delete_access),
):
    """
    Deletes an existing Review by its ID.
    """
    deleted = await remove_review(id)
    if not deleted:
        # This assumes remove_review returns a boolean or similar
        # to indicate if deletion was successful (i.e., item was found).
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Review not found or deletion failed")
    
    return None
