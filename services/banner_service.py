# ============================================================================
# BANNER SERVICE
# ============================================================================
# This file was auto-generated on: 2026-02-23 22:11:17 WAT
# It contains  asynchrounous functions that make use of the repo functions 
# 
# ============================================================================

from bson import ObjectId
from fastapi import HTTPException
from typing import List

from repositories.banner import (
    create_banner,
    get_banner,
    get_banners,
    update_banner,
    delete_banner,
)
from schemas.banner import BannerCreate, BannerUpdate, BannerOut


async def add_banner(banner_data: BannerCreate) -> BannerOut:
    """adds an entry of BannerCreate to the database and returns an object

    Returns:
        _type_: BannerOut
    """
    return await create_banner(banner_data)


async def remove_banner(banner_id: str):
    """deletes a field from the database and removes BannerCreateobject 

    Raises:
        HTTPException 400: Invalid banner ID format
        HTTPException 404:  Banner not found
    """
    if not ObjectId.is_valid(banner_id):
        raise HTTPException(status_code=400, detail="Invalid banner ID format")

    filter_dict = {"_id": ObjectId(banner_id)}
    result = await delete_banner(filter_dict)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Banner not found")

    else: return True
    
async def retrieve_banner_by_banner_id(id: str) -> BannerOut:
    """Retrieves banner object based specific Id 

    Raises:
        HTTPException 404(not found): if  Banner not found in the db
        HTTPException 400(bad request): if  Invalid banner ID format

    Returns:
        _type_: BannerOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid banner ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_banner(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="Banner not found")

    return result


async def retrieve_banners(filters: dict | None = None, start: int = 0, stop: int = 100) -> List[BannerOut]:
    """Retrieves BannerOut Objects in a list

    Returns:
        _type_: BannerOut
    """
    return await get_banners(filter_dict=filters or {}, start=start, stop=stop)


async def update_banner_by_id(id: str, data: BannerUpdate) -> BannerOut:
    """updates an entry of banner in the database

    Raises:
        HTTPException 404(not found): if Banner not found or update failed
        HTTPException 400(not found): Invalid banner ID format

    Returns:
        _type_: BannerOut
    """
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid banner ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await update_banner(filter_dict, data)

    if not result:
        raise HTTPException(status_code=404, detail="Banner not found or update failed")

    return result