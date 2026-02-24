from __future__ import annotations

from typing import List

from bson import ObjectId
from fastapi import HTTPException

from repositories.autocomplete_search_result import (
    create_autocomplete_search_result,
    delete_autocomplete_search_result,
    get_autocomplete_search_result,
    get_autocomplete_search_results,
    update_autocomplete_search_result,
)
from schemas.autocomplete_search_result import (
    AutocompleteSearchResultCreate,
    AutocompleteSearchResultOut,
    AutocompleteSearchResultUpdate,
)
from schemas.place import PlaceOut
from security.principal import AuthPrincipal


def _normalize_search_input(search_input: str) -> str:
    normalized = " ".join(search_input.strip().split())
    if len(normalized) < 2:
        raise HTTPException(status_code=400, detail="search_input must be at least 2 characters")
    return normalized


async def add_autocomplete_search_result(
    autocomplete_search_result_data: AutocompleteSearchResultCreate,
) -> AutocompleteSearchResultOut:
    return await create_autocomplete_search_result(autocomplete_search_result_data)


async def save_search_result_for_principal(
    *,
    principal: AuthPrincipal,
    search_input: str,
    place: PlaceOut,
) -> AutocompleteSearchResultOut:
    payload = AutocompleteSearchResultCreate(
        search_input=_normalize_search_input(search_input),
        user_id=principal.user_id,
        place=place,
    )
    return await add_autocomplete_search_result(payload)


async def list_search_results_for_principal(
    *,
    principal: AuthPrincipal,
    start: int = 0,
    stop: int = 100,
) -> list[AutocompleteSearchResultOut]:
    return await retrieve_autocomplete_search_results(
        filters={"user_id": principal.user_id},
        start=start,
        stop=stop,
    )


async def remove_autocomplete_search_result(autocomplete_search_result_id: str):
    if not ObjectId.is_valid(autocomplete_search_result_id):
        raise HTTPException(status_code=400, detail="Invalid autocomplete_search_result ID format")

    filter_dict = {"_id": ObjectId(autocomplete_search_result_id)}
    result = await delete_autocomplete_search_result(filter_dict)

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="AutocompleteSearchResult not found")
    return True


async def retrieve_autocomplete_search_result_by_autocomplete_search_result_id(id: str) -> AutocompleteSearchResultOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid autocomplete_search_result ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await get_autocomplete_search_result(filter_dict)

    if not result:
        raise HTTPException(status_code=404, detail="AutocompleteSearchResult not found")

    return result


async def retrieve_autocomplete_search_results(
    filters: dict | None = None,
    start: int = 0,
    stop: int = 100,
) -> List[AutocompleteSearchResultOut]:
    return await get_autocomplete_search_results(filter_dict=filters or {}, start=start, stop=stop)


async def update_autocomplete_search_result_by_id(id: str, data: AutocompleteSearchResultUpdate) -> AutocompleteSearchResultOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid autocomplete_search_result ID format")

    filter_dict = {"_id": ObjectId(id)}
    result = await update_autocomplete_search_result(filter_dict, data)

    if not result:
        raise HTTPException(status_code=404, detail="AutocompleteSearchResult not found or update failed")

    return result
