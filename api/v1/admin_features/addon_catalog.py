from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.addon_catalog import AddonCatalogBase, AddonCatalogCreate, AddonCatalogUpdate
from services.addon_catalog_service import (
    add_addon_catalog,
    remove_addon_catalog,
    retrieve_addon_catalog_by_id,
    retrieve_addon_catalogs,
    update_addon_catalog_by_id,
)

router = APIRouter(prefix="/add-ons", tags=["Admin Add-ons"])


@router.get("/")
@document_response(message="AddonCatalog list fetched successfully", success_example=[])
async def list_addon_catalogs(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=100, gt=0, le=500),
    filters: str | None = Query(default=None),
):
    parsed_filters: dict = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filters JSON") from err
    return await retrieve_addon_catalogs(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="AddonCatalog fetched successfully")
async def get_addon_catalog(id: str = Path(..., description="Resource identifier")):
    return await retrieve_addon_catalog_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="AddonCatalog created successfully", status_code=status.HTTP_201_CREATED)
async def create_addon_catalog(payload: AddonCatalogBase):
    return await add_addon_catalog(AddonCatalogCreate(**payload.model_dump()))


@router.patch("/{id}")
@document_response(message="AddonCatalog updated successfully")
async def patch_addon_catalog(id: str, payload: AddonCatalogUpdate):
    return await update_addon_catalog_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="AddonCatalog deleted successfully")
async def delete_addon_catalog(id: str):
    await remove_addon_catalog(id=id)
    return None
