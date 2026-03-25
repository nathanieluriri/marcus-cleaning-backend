from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.addon_catalog import create_addon_catalog, delete_addon_catalog, get_addon_catalog, get_addon_catalogs, update_addon_catalog
from schemas.addon_catalog import AddonCatalogCreate, AddonCatalogOut, AddonCatalogUpdate


async def add_addon_catalog(payload: AddonCatalogCreate) -> AddonCatalogOut:
    return await create_addon_catalog(payload)


async def retrieve_addon_catalog_by_id(*, id: str) -> AddonCatalogOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_addon_catalog({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="AddonCatalog not found")
    return result


async def retrieve_addon_catalogs(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[AddonCatalogOut]:
    return await get_addon_catalogs(filter_dict=filters or {}, start=start, stop=stop)


async def update_addon_catalog_by_id(*, id: str, payload: AddonCatalogUpdate) -> AddonCatalogOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_addon_catalog({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="AddonCatalog not found")
    return result


async def remove_addon_catalog(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_addon_catalog({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="AddonCatalog not found")
    return True
