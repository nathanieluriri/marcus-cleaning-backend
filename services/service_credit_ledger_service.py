from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from repositories.service_credit_ledger import create_service_credit_ledger, delete_service_credit_ledger, get_service_credit_ledger, get_service_credit_ledgers, update_service_credit_ledger
from schemas.service_credit_ledger import ServiceCreditLedgerCreate, ServiceCreditLedgerOut, ServiceCreditLedgerUpdate


async def add_service_credit_ledger(payload: ServiceCreditLedgerCreate) -> ServiceCreditLedgerOut:
    return await create_service_credit_ledger(payload)


async def retrieve_service_credit_ledger_by_id(*, id: str) -> ServiceCreditLedgerOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_service_credit_ledger({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceCreditLedger not found")
    return result


async def retrieve_service_credit_ledgers(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[ServiceCreditLedgerOut]:
    return await get_service_credit_ledgers(filter_dict=filters or {}, start=start, stop=stop)


async def update_service_credit_ledger_by_id(*, id: str, payload: ServiceCreditLedgerUpdate) -> ServiceCreditLedgerOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_service_credit_ledger({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="ServiceCreditLedger not found")
    return result


async def remove_service_credit_ledger(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_service_credit_ledger({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="ServiceCreditLedger not found")
    return True


async def get_customer_service_credit_balance(*, customer_id: str) -> int:
    ledger_entries = await get_service_credit_ledgers(filter_dict={"customer_id": customer_id}, start=0, stop=1000)
    return int(sum(item.amount_minor for item in ledger_entries))
