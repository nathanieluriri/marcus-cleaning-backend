from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from core.errors import auth_permission_denied
from core.response_envelope import document_response
from schemas.payment_schema import RefundIn
from security.auth import verify_any_token
from security.principal import AuthPrincipal
from services.payment_service import (
    get_payment_transaction,
    get_payment_transaction_by_reference_or_404,
    process_webhook,
    refund_payment,
)

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.post("/webhooks/{provider}")
@document_response(message="Webhook processed")
async def payment_webhook(provider: str, request: Request):
    """
    Receive payment webhooks for a specific provider.

    Accepted `provider` path values:
    - `stripe`
    - `flutterwave`
    - `test`
    """
    body = await request.body()
    headers = {k: v for k, v in request.headers.items()}
    return await process_webhook(provider_name=provider, body=body, headers=headers)


@router.get("/{payment_id}")
@document_response(message="Payment transaction fetched")
async def fetch_transaction(payment_id: str, principal: AuthPrincipal = Depends(verify_any_token)):
    tx = await get_payment_transaction(payment_id=payment_id)
    if tx.owner_id != principal.user_id and not principal.is_admin:
        raise auth_permission_denied("GET:/v1/payments/{payment_id}")
    return tx


@router.get("/reference/{reference}")
@document_response(message="Payment transaction fetched by reference")
async def fetch_transaction_by_reference(reference: str, principal: AuthPrincipal = Depends(verify_any_token)):
    tx = await get_payment_transaction_by_reference_or_404(reference=reference)
    if tx.owner_id != principal.user_id and not principal.is_admin:
        raise auth_permission_denied("GET:/v1/payments/reference/{reference}")
    return tx


@router.post("/{payment_id}/refund")
@document_response(message="Payment refunded")
async def refund_transaction(
    payment_id: str,
    payload: RefundIn,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    tx = await get_payment_transaction(payment_id=payment_id)
    if tx.owner_id != principal.user_id and not principal.is_admin:
        raise auth_permission_denied("POST:/v1/payments/{payment_id}/refund")
    return await refund_payment(payment_id=payment_id, amount_minor=payload.amount_minor)
