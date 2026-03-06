
from fastapi import APIRouter, HTTPException, Query, Path, status
from typing import Optional
import json
from core.response_envelope import document_response
from schemas.notifications import (
    NotificationsCreate,
    NotificationsOut,
    NotificationsBase,
    NotificationsUpdate,
)
from services.notifications_service import (
    add_notifications,
    remove_notifications,
    retrieve_notificationss,
    retrieve_notifications_by_notifications_id,
    update_notifications_by_id,
)

router = APIRouter(prefix="/notificationss", tags=["Notificationss"])


# ------------------------------
# List Notificationss (with pagination and filtering)
# ------------------------------
@router.get("/")
@document_response(
    message="Notificationss fetched successfully",
    success_example=[],
)
async def list_notificationss(
    start: Optional[int] = Query(None, description="Start index for range-based pagination"),
    stop: Optional[int] = Query(None, description="Stop index for range-based pagination"),
    page_number: Optional[int] = Query(None, description="Page number for page-based pagination (0-indexed)"),
    # New: Filter parameter expects a JSON string
    filters: Optional[str] = Query(None, description="Optional JSON string of MongoDB filter criteria (e.g., '{\"field\": \"value\"}')")
):
    """
    Retrieves a list of Notificationss with pagination and optional filtering.
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
        items = await retrieve_notificationss(filters=parsed_filters, start=start, stop=stop)
        return items

    # Case 2: Use page_number if provided
    elif page_number is not None:
        if page_number < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="'page_number' cannot be negative.")
        
        start_index = page_number * PAGE_SIZE
        stop_index = start_index + PAGE_SIZE
        # Pass filters to the service layer
        items = await retrieve_notificationss(filters=parsed_filters, start=start_index, stop=stop_index)
        return items

    # Case 3: Default (no params)
    else:
        # Pass filters to the service layer
        items = await retrieve_notificationss(filters=parsed_filters, start=0, stop=100)
        return items


# ------------------------------
# Retrieve a single Notifications
# ------------------------------
@router.get("/{id}")
@document_response(message="Notifications fetched successfully")
async def get_notifications_by_id(
    id: str = Path(..., description="notifications ID to fetch specific item")
):
    """
    Retrieves a single Notifications by its ID.
    """
    item = await retrieve_notifications_by_notifications_id(id=id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Notifications not found")
    return item


# ------------------------------
# Create a new Notifications
# ------------------------------
# Uses NotificationsBase for input (correctly)
@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(
    message="Notifications created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def create_notifications(payload: NotificationsBase):
    """
    Creates a new Notifications.
    """
    # Creates NotificationsCreate object which includes date_created/last_updated
    new_data = NotificationsCreate(**payload.model_dump()) 
    new_item = await add_notifications(new_data)
    if not new_item:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to create notifications")
    
    return new_item


# ------------------------------
# Update an existing Notifications
# ------------------------------
# Uses PATCH for partial update (correctly)
@router.patch("/{id}")
@document_response(message="Notifications updated successfully")
async def update_notifications(
    id: str = Path(..., description="ID of the {db_name} to update"),
    payload: NotificationsUpdate = None
):
    """
    Updates an existing Notifications by its ID.
    Assumes the service layer handles partial updates (e.g., ignores None fields in payload).
    """
    updated_item = await update_notifications_by_id(id=id, data=payload)
    if not updated_item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Notifications not found or update failed")
    
    return updated_item


# ------------------------------
# Delete an existing Notifications
# ------------------------------
@router.delete("/{id}")
@document_response(message="Notifications deleted successfully")
async def delete_notifications(id: str = Path(..., description="ID of the notifications to delete")):
    """
    Deletes an existing Notifications by its ID.
    """
    deleted = await remove_notifications(id)
    if not deleted:
        # This assumes remove_notifications returns a boolean or similar
        # to indicate if deletion was successful (i.e., item was found).
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Notifications not found or deletion failed")
    
    return None
