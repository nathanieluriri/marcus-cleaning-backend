
from fastapi import APIRouter, HTTPException, Query, Path, status
from typing import Optional
import json
from core.response_envelope import document_response
from schemas.banner import (
    BannerCreate,
    BannerOut,
    BannerBase,
    BannerUpdate,
)
from services.banner_service import (
    add_banner,
    remove_banner,
    retrieve_banners,
    retrieve_banner_by_banner_id,
    update_banner_by_id,
)

router = APIRouter(prefix="/banners", tags=["Banners"])


# ------------------------------
# List Banners (with pagination and filtering)
# ------------------------------
@router.get("/")
@document_response(
    message="Banners fetched successfully",
    success_example=[],
)
async def list_banners(
    start: Optional[int] = Query(None, description="Start index for range-based pagination"),
    stop: Optional[int] = Query(None, description="Stop index for range-based pagination"),
    page_number: Optional[int] = Query(None, description="Page number for page-based pagination (0-indexed)"),
    # New: Filter parameter expects a JSON string
    filters: Optional[str] = Query(None, description="Optional JSON string of MongoDB filter criteria (e.g., '{\"field\": \"value\"}')")
):
    """
    Retrieves a list of Banners with pagination and optional filtering.
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
        items = await retrieve_banners(filters=parsed_filters, start=start, stop=stop)
        return items

    # Case 2: Use page_number if provided
    elif page_number is not None:
        if page_number < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'page_number' cannot be negative.")
        
        start_index = page_number * PAGE_SIZE
        stop_index = start_index + PAGE_SIZE
        # Pass filters to the service layer
        items = await retrieve_banners(filters=parsed_filters, start=start_index, stop=stop_index)
        return items

    # Case 3: Default (no params)
    else:
        # Pass filters to the service layer
        items = await retrieve_banners(filters=parsed_filters, start=0, stop=100)
        return items


# ------------------------------
# Retrieve a single Banner
# ------------------------------
@router.get("/{id}")
@document_response(message="Banner fetched successfully")
async def get_banner_by_id(
    id: str = Path(..., description="banner ID to fetch specific item")
):
    """
    Retrieves a single Banner by its ID.
    """
    item = await retrieve_banner_by_banner_id(id=id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Banner not found")
    return item


# ------------------------------
# Create a new Banner
# ------------------------------
# Uses BannerBase for input (correctly)
@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(
    message="Banner created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def create_banner(payload: BannerBase):
    """
    Creates a new Banner.
    """
    # Creates BannerCreate object which includes date_created/last_updated
    new_data = BannerCreate(**payload.model_dump()) 
    new_item = await add_banner(new_data)
    if not new_item:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to create banner")
    
    return new_item


# ------------------------------
# Update an existing Banner
# ------------------------------
# Uses PATCH for partial update (correctly)
@router.patch("/{id}")
@document_response(message="Banner updated successfully")
async def update_banner(
    id: str = Path(..., description="ID of the {db_name} to update"),
    payload: BannerUpdate = None
):
    """
    Updates an existing Banner by its ID.
    Assumes the service layer handles partial updates (e.g., ignores None fields in payload).
    """
    updated_item = await update_banner_by_id(id=id, data=payload)
    if not updated_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Banner not found or update failed")
    
    return updated_item


# ------------------------------
# Delete an existing Banner
# ------------------------------
@router.delete("/{id}")
@document_response(message="Banner deleted successfully")
async def delete_banner(id: str = Path(..., description="ID of the banner to delete")):
    """
    Deletes an existing Banner by its ID.
    """
    deleted = await remove_banner(id)
    if not deleted:
        # This assumes remove_banner returns a boolean or similar
        # to indicate if deletion was successful (i.e., item was found).
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Banner not found or deletion failed")
    
    return None
