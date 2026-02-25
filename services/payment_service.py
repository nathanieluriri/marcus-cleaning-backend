from __future__ import annotations

import time

from core.errors import AppException, ErrorCode, resource_not_found
from core.payments import PaymentIntentRequest, PaymentManager
from repositories.booking_repo import get_booking_by_id
from repositories.payment_repo import (
    create_payment_transaction,
    get_payment_transaction_by_booking_id,
    get_payment_transaction_by_id,
    get_payment_transaction_by_reference,
    is_webhook_event_processed,
    mark_webhook_event_processed,
    update_payment_transaction_status,
)
from schemas.payment_schema import PaymentIntentIn, PaymentTransactionCreate, WebhookReplayCreate
from services.customer_service import retrieve_user_by_user_id
from services.pricing_service import calculate_quote_for_booking


def _epoch() -> int:
    return int(time.time())


def _get_payment_manager() -> PaymentManager:
    try:
        return PaymentManager.get_instance()
    except RuntimeError as err:
        raise AppException(
            status_code=503,
            code=ErrorCode.PAYMENT_PROVIDER_ERROR,
            message="Payment providers are not configured",
            details=str(err),
        ) from err


async def create_payment_intent(*, owner_id: str, payload: PaymentIntentIn):
    provider_name = (payload.provider or "").lower() or None
    provider = _get_payment_manager().get_provider(provider_name)

    existing = await get_payment_transaction_by_reference(reference=payload.reference)
    if existing is not None:
        return existing

    intent = await provider.create_intent(
        PaymentIntentRequest(
            amount_minor=payload.amount_minor,
            currency=payload.currency,
            reference=payload.reference,
            customer_email=payload.customer_email,
            metadata=payload.metadata,
        )
    )

    return await create_payment_transaction(
        PaymentTransactionCreate(
            owner_id=owner_id,
            booking_id=str(payload.metadata.get("booking_id")) if payload.metadata and payload.metadata.get("booking_id") else None,
            provider=intent.provider.value,
            reference=intent.reference,
            status=intent.status.value,
            amount_minor=payload.amount_minor,
            currency=payload.currency,
            response_payload=intent.provider_payload,
            idempotency_key=f"{intent.provider.value}:{intent.reference}",
            created_at=_epoch(),
            updated_at=_epoch(),
        )
    )


async def create_payment_for_booking(*, booking_id: str):
    existing = await get_payment_transaction_by_booking_id(booking_id=booking_id)
    if existing is not None:
        return existing

    booking = await get_booking_by_id(booking_id)
    if booking is None:
        raise resource_not_found("Booking", booking_id)

    quote = await calculate_quote_for_booking(booking=booking)
    customer = await retrieve_user_by_user_id(booking.customer_id)

    reference = f"booking-{booking_id}"
    existing_by_reference = await get_payment_transaction_by_reference(reference=reference)
    if existing_by_reference is not None:
        return existing_by_reference

    provider = _get_payment_manager().get_provider(None)
    intent = await provider.create_intent(
        PaymentIntentRequest(
            amount_minor=quote.amount_minor,
            currency=quote.currency,
            reference=reference,
            customer_email=customer.email,
            metadata={
                "booking_id": booking_id,
                "customer_id": booking.customer_id,
                "cleaner_id": booking.cleaner_id,
                "place_id": booking.place_id,
                "service": booking.service.value,
                "price_breakdown": quote.breakdown,
            },
        )
    )

    return await create_payment_transaction(
        PaymentTransactionCreate(
            owner_id=booking.customer_id,
            booking_id=booking_id,
            provider=intent.provider.value,
            reference=intent.reference,
            status=intent.status.value,
            amount_minor=quote.amount_minor,
            currency=quote.currency,
            response_payload=intent.provider_payload,
            idempotency_key=f"{intent.provider.value}:{intent.reference}",
            created_at=_epoch(),
            updated_at=_epoch(),
        )
    )


async def process_webhook(*, provider_name: str, body: bytes, headers: dict[str, str]):
    provider = _get_payment_manager().get_provider(provider_name)
    event = await provider.verify_webhook(body=body, headers=headers)

    if await is_webhook_event_processed(provider=provider_name, event_id=event.event_id):
        raise AppException(
            status_code=409,
            code=ErrorCode.PAYMENT_WEBHOOK_INVALID,
            message="Webhook already processed",
            details={"event_id": event.event_id},
        )

    reference = (
        event.payload.get("data", {}).get("tx_ref")
        or event.payload.get("data", {}).get("reference")
        or event.payload.get("reference")
    )
    if not reference:
        raise AppException(
            status_code=400,
            code=ErrorCode.PAYMENT_WEBHOOK_INVALID,
            message="Webhook missing reference",
            details=event.payload,
        )

    tx = await provider.fetch_transaction(reference=reference)
    updated = await update_payment_transaction_status(
        reference=reference,
        status=tx.status.value,
        response_payload=tx.raw,
    )
    if updated is None:
        raise resource_not_found("PaymentTransaction", reference)
    await mark_webhook_event_processed(
        WebhookReplayCreate(provider=provider_name, event_id=event.event_id, created_at=_epoch())
    )
    return {"processed": True, "reference": reference, "status": tx.status.value}


async def get_payment_transaction(payment_id: str):
    tx = await get_payment_transaction_by_id(payment_id=payment_id)
    if tx is None:
        raise resource_not_found("PaymentTransaction", payment_id)
    return tx


async def get_payment_transaction_by_reference_or_404(reference: str):
    tx = await get_payment_transaction_by_reference(reference=reference)
    if tx is None:
        raise resource_not_found("PaymentTransaction", reference)
    return tx


async def refund_payment(*, payment_id: str, amount_minor: int | None = None):
    tx = await get_payment_transaction_by_id(payment_id=payment_id)
    if tx is None:
        raise resource_not_found("PaymentTransaction", payment_id)

    provider = _get_payment_manager().get_provider(tx.provider)
    refunded = await provider.refund(reference=tx.reference, amount_minor=amount_minor)
    updated = await update_payment_transaction_status(
        reference=tx.reference,
        status=refunded.status.value,
        response_payload=refunded.raw,
    )
    if updated is None:
        raise resource_not_found("PaymentTransaction", payment_id)
    return updated
