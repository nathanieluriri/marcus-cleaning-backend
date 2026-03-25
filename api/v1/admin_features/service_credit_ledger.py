from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Path, Query, status

from core.response_envelope import document_response
from schemas.service_credit_ledger import ServiceCreditLedgerBase, ServiceCreditLedgerCreate, ServiceCreditLedgerUpdate
from services.service_credit_ledger_service import (
    add_service_credit_ledger,
    get_customer_service_credit_balance,
    remove_service_credit_ledger,
    retrieve_service_credit_ledger_by_id,
    retrieve_service_credit_ledgers,
    update_service_credit_ledger_by_id,
)

router = APIRouter(prefix="/service-credits", tags=["Admin Service Credits"])


@router.get("/")
@document_response(message="ServiceCreditLedger list fetched successfully", success_example=[])
async def list_service_credit_ledgers(
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
    return await retrieve_service_credit_ledgers(filters=parsed_filters, start=start, stop=stop)


@router.get("/{id}")
@document_response(message="ServiceCreditLedger fetched successfully")
async def get_service_credit_ledger(id: str = Path(..., description="Resource identifier")):
    return await retrieve_service_credit_ledger_by_id(id=id)


@router.post("/", status_code=status.HTTP_201_CREATED)
@document_response(message="ServiceCreditLedger created successfully", status_code=status.HTTP_201_CREATED)
async def create_service_credit_ledger(payload: ServiceCreditLedgerBase):
    return await add_service_credit_ledger(ServiceCreditLedgerCreate(**payload.model_dump()))


@router.post("/grant", status_code=status.HTTP_201_CREATED)
@document_response(message="Service credit granted successfully", status_code=status.HTTP_201_CREATED)
async def grant_service_credit(payload: ServiceCreditLedgerBase):
    grant_payload = ServiceCreditLedgerCreate(**payload.model_dump())
    return await add_service_credit_ledger(grant_payload)


@router.get("/balance/{customer_id}")
@document_response(message="Service credit balance fetched successfully")
async def get_service_credit_balance(customer_id: str = Path(..., description="Customer identifier")):
    balance_minor = await get_customer_service_credit_balance(customer_id=customer_id)
    return {"customer_id": customer_id, "balance_minor": balance_minor}


@router.patch("/{id}")
@document_response(message="ServiceCreditLedger updated successfully")
async def patch_service_credit_ledger(id: str, payload: ServiceCreditLedgerUpdate):
    return await update_service_credit_ledger_by_id(id=id, payload=payload)


@router.delete("/{id}")
@document_response(message="ServiceCreditLedger deleted successfully")
async def delete_service_credit_ledger(id: str):
    await remove_service_credit_ledger(id=id)
    return None
