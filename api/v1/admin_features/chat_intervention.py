from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.admin_schema import AdminOut
from schemas.chat_intervention import ChatInterventionCreate, ChatInterventionCreateRequest, ChatInterventionUpdate
from security.account_status_check import check_admin_account_status_and_permissions
from services.chat_intervention_service import (
    add_chat_intervention,
    remove_chat_intervention,
    retrieve_chat_intervention_by_id,
    retrieve_chat_interventions,
    update_chat_intervention_by_id,
)

router = APIRouter(prefix="/chat-interventions", tags=["Admin Chat Interventions"])


@router.get("/")
@document_response(message="ChatIntervention list fetched successfully", success_example=[])
async def list_chat_interventions(
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
    return await retrieve_chat_interventions(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ChatIntervention fetched successfully")
async def get_chat_intervention(id: str = Path(..., description="Resource identifier")):
    return await retrieve_chat_intervention_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ChatIntervention created successfully", status_code=status.HTTP_201_CREATED)
async def create_chat_intervention(
    payload: ChatInterventionCreateRequest,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await add_chat_intervention(
        ChatInterventionCreate(
            **payload.model_dump(),
            admin_id=admin.id or "",
        )
    )


@router.patch("/{id}")
@document_response(message="ChatIntervention updated successfully")
async def patch_chat_intervention(id: str, payload: ChatInterventionUpdate):
    return await update_chat_intervention_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="ChatIntervention deleted successfully")
async def delete_chat_intervention(id: str):
    await remove_chat_intervention(id=id)
    return None
