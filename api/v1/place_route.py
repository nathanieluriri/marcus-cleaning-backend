from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from core.response_envelope import document_response
from schemas.autocomplete_search_result import AutocompleteSearchResultSaveRequest
from security.auth import verify_any_token
from security.principal import AuthPrincipal
from services.autocomplete_search_result_service import (
    list_search_results_for_principal,
    save_search_result_for_principal,
)
from services.place_service import (
    get_allowed_countries,
    get_autocomplete,
    get_place_details,
    get_reverse_geocode,
)

router = APIRouter(prefix="/places", tags=["Places"])


@router.get("/allowed-countries")
@document_response(message="Allowed countries fetched successfully", success_example=["NG"])
async def list_allowed_countries():
    return await get_allowed_countries()


@router.get("/autocomplete")
@document_response(message="Place autocomplete suggestions fetched successfully", success_example=[])
async def autocomplete_places(
    input: str = Query(..., description="Partial location input."),
    country: str | None = Query(default=None, description="Optional 2-letter country code."),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    _ = principal
    return await get_autocomplete(input_text=input, country=country)


@router.get("/details")
@document_response(message="Place details fetched successfully")
async def fetch_place_details(
    place_id: str = Query(..., description="Google place_id value."),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    _ = principal
    return await get_place_details(place_id=place_id)


@router.post("/search-results")
@document_response(message="Search result saved successfully", status_code=201)
async def save_place_search_result(
    payload: AutocompleteSearchResultSaveRequest,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await save_search_result_for_principal(
        principal=principal,
        search_input=payload.search_input,
        place=payload.place,
    )


@router.get("/search-results")
@document_response(message="Search history fetched successfully", success_example=[])
async def list_place_search_results(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=20, gt=0, le=100),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await list_search_results_for_principal(
        principal=principal,
        start=start,
        stop=stop,
    )


@router.get("/reverse-geocode")
@document_response(message="Reverse geocode completed successfully")
async def reverse_geocode_place(
    lat: float = Query(..., description="Latitude from device coordinates."),
    lng: float = Query(..., description="Longitude from device coordinates."),
    country: str | None = Query(default=None, description="Optional 2-letter country code."),
):
    return await get_reverse_geocode(lat=lat, lng=lng, country=country)
