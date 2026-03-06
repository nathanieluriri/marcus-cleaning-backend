# ============================================================================
# NOTIFICATIONS SERVICE
# ============================================================================
# This file was auto-generated on: 2026-03-06 08:56:43 WAT
# It contains  asynchrounous functions that make use of the repo functions 
# 
# ============================================================================

from bson import ObjectId
from fastapi import HTTPException
from typing import List

from repositories.notifications import (
    create_notifications,
    get_notifications,
    get_notificationss,
    update_notifications,
    delete_notifications,
)
from schemas.notifications import NotificationsCreate, NotificationsUpdate, NotificationsOut


async def add_notifications(notifications_data: NotificationsCreate) -> NotificationsOut:
    """adds an entry of NotificationsCreate to the database and returns an object

    Returns:
        _type_: NotificationsOut
    """
    return await create_notifications(notifications_data)


async def remove_notifications(notifications_id: str):
    """deletes a field from the database and removes NotificationsCreateobject 

    Raises:
        HTTPException 400: Invalid notifications ID format
        HTTPException 404:  Notifications not found
    """
    if not ObjectId.is_valid(notifications_id):
        raise HTTPException(status_code=400, detail="Invalid notifications ID format")

    filter_dict = {"_id": ObjectId(notifications_id)}
    result = await delete_notifications(filter_dict)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notifications not found")

    else: return True
    
async def retrieve_notifications_by_notifications_id(id: str) -> NotificationsOut:
    """Retrieves notifications object based specific Id 

    Raises:
        HTTPException 404(not found): if  Notifications not found in the db
        HTTPException 400(bad request): if  Invalid notifications ID format

    Returns:
        _type_: NotificationsOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid notifications ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_notifications(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="Notifications not found")

    return result


async def retrieve_notificationss(filters: dict | None = None, start: int = 0, stop: int = 100) -> List[NotificationsOut]:
    """Retrieves NotificationsOut Objects in a list

    Returns:
        _type_: NotificationsOut
    """
    return await get_notificationss(filter_dict=filters or {}, start=start, stop=stop)


async def update_notifications_by_id(id: str, data: NotificationsUpdate) -> NotificationsOut:
    """updates an entry of notifications in the database

    Raises:
        HTTPException 404(not found): if Notifications not found or update failed
        HTTPException 400(not found): Invalid notifications ID format

    Returns:
        _type_: NotificationsOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid notifications ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await update_notifications(filter_dict, data)

    if not result:
        raise HTTPException(status_code=404, detail="Notifications not found or update failed")

    return result