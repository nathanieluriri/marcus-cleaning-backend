from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request

from core.errors import auth_permission_denied
from core.response_envelope import document_response
from schemas.payment_schema import PaymentMethodCreateIn, PaymentMethodUpdateIn, RefundIn
from security.auth import verify_any_token
from security.principal import AuthPrincipal
from services.payment_service import (
    add_payment_method_for_owner,
    delete_payment_method_for_owner,
    get_payment_transaction,
    get_payment_transaction_by_reference_or_404,
    list_payment_methods_for_owner,
    process_webhook,
    reconcile_payment_transaction,
    refund_payment,
    set_default_payment_method_for_owner,
    update_payment_method_for_owner,
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


@router.get("/methods")
@document_response(message="Payment methods fetched")
async def list_methods(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=20, gt=0, le=100),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await list_payment_methods_for_owner(owner_id=principal.user_id, start=start, stop=stop)


@router.post("/methods", status_code=201)
@document_response(message="Payment method created", status_code=201)
async def add_method(
    payload: PaymentMethodCreateIn,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await add_payment_method_for_owner(owner_id=principal.user_id, payload=payload)


@router.patch("/methods/{method_id}")
@document_response(message="Payment method updated")
async def update_method(
    method_id: str = Path(..., description="Payment method identifier"),
    payload: PaymentMethodUpdateIn = ...,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await update_payment_method_for_owner(
        owner_id=principal.user_id,
        method_id=method_id,
        payload=payload,
    )


@router.delete("/methods/{method_id}")
@document_response(message="Payment method deleted")
async def delete_method(
    method_id: str = Path(..., description="Payment method identifier"),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await delete_payment_method_for_owner(owner_id=principal.user_id, method_id=method_id)


@router.post("/methods/{method_id}/set-default")
@document_response(message="Default payment method updated")
async def set_default_method(
    method_id: str = Path(..., description="Payment method identifier"),
    principal: AuthPrincipal = Depends(verify_any_token),
):
    return await set_default_payment_method_for_owner(owner_id=principal.user_id, method_id=method_id)


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


@router.post("/{payment_id}/reconcile")
@document_response(message="Payment transaction reconciled")
async def reconcile_transaction(
    payment_id: str,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    if not principal.is_admin:
        raise auth_permission_denied("POST:/v1/payments/{payment_id}/reconcile")
    return await reconcile_payment_transaction(payment_id=payment_id)
