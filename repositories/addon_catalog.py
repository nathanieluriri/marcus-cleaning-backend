from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.addon_catalog import AddonCatalogCreate, AddonCatalogOut, AddonCatalogUpdate


def _collection():
    return db.addon_catalog


async def create_addon_catalog(payload: AddonCatalogCreate) -> AddonCatalogOut:
    result = await _collection().insert_one(payload.model_dump())
    row = await _collection().find_one({"_id": result.inserted_id})
    return AddonCatalogOut(**row)


async def get_addon_catalog(filter_dict: dict) -> Optional[AddonCatalogOut]:
    try:
        row = await _collection().find_one(filter_dict)
        if row is None:
            return None
        return AddonCatalogOut(**row)
    except Exception as err:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to fetch addon_catalog: {err}") from err


async def get_addon_catalogs(*, filter_dict: dict | None = None, start: int = 0, stop: int = 100) -> list[AddonCatalogOut]:
    query = filter_dict or {}
    cursor = _collection().find(query).skip(start).limit(max(stop - start, 0))
    items: list[AddonCatalogOut] = []
    async for row in cursor:
        items.append(AddonCatalogOut(**row))
    return items


async def update_addon_catalog(filter_dict: dict, payload: AddonCatalogUpdate) -> AddonCatalogOut | None:
    row = await _collection().find_one_and_update(
        filter_dict,
        {"$set": payload.model_dump(exclude_none=True)},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return None
    return AddonCatalogOut(**row)


async def delete_addon_catalog(filter_dict: dict):
    return await _collection().delete_one(filter_dict)
