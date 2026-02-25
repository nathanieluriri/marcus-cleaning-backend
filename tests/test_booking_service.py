from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.errors import AppException, ErrorCode
from schemas.booking import BookingBase, BookingOut
from schemas.imports import BookingStatus, CleaningServices, Duration, Extra
from security.principal import AuthPrincipal
from services import booking_service


def _principal(*, role: str = "customer", user_id: str = "customer-1") -> AuthPrincipal:
    return AuthPrincipal(
        user_id=user_id,
        role=role,  # type: ignore[arg-type]
        access_token_id="access-1",
        jwt_token="jwt-1",
    )


def _booking_payload(*, customer_id: str = "customer-1") -> BookingBase:
    return BookingBase(
        customer_id=customer_id,
        place_id="place-1",
        cleaner_id="cleaner-1",
        extras=Extra(add_ons=[]),
        service=CleaningServices.STANDARD,
        duration=Duration(hours=2, minutes=0),
        custom_details=None,
    )


def _booking_out(**overrides) -> BookingOut:
    payload = {
        "id": "booking-1",
        "customer_id": "customer-1",
        "place_id": "place-1",
        "cleaner_id": "cleaner-1",
        "extras": Extra(add_ons=[]),
        "service": CleaningServices.STANDARD,
        "duration": Duration(hours=2, minutes=0),
        "custom_details": None,
        "status": BookingStatus.REQUESTED,
        "cleaner_acceptance_deadline": 4_000_000_000,
    }
    payload.update(overrides)
    return BookingOut(**payload)


@pytest.mark.asyncio
async def test_create_booking_for_customer_attaches_payment_and_quote(monkeypatch: pytest.MonkeyPatch):
    payload = _booking_payload()
    principal = _principal()

    async def _stub_retrieve_customer(*, id: str):
        assert id == "customer-1"
        return SimpleNamespace(id=id)

    async def _stub_retrieve_cleaner(*, id: str):
        assert id == "cleaner-1"
        return SimpleNamespace(id=id)

    async def _stub_create_booking(booking_create):
        assert booking_create.customer_id == "customer-1"
        assert booking_create.status == BookingStatus.REQUESTED
        return _booking_out()

    async def _stub_create_payment_for_booking(*, booking_id: str):
        assert booking_id == "booking-1"
        return SimpleNamespace(id="payment-1")

    async def _stub_calculate_quote_for_booking_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return SimpleNamespace(
            amount_minor=11_500,
            currency="NGN",
            breakdown={"total_amount": 11_500},
        )

    async def _stub_update_booking_fields(*, booking_id: str, update_dict: dict):
        assert booking_id == "booking-1"
        assert update_dict["payment_id"] == "payment-1"
        assert update_dict["price_amount_minor"] == 11_500
        assert update_dict["price_currency"] == "NGN"
        return _booking_out(
            payment_id="payment-1",
            price_amount_minor=11_500,
            price_currency="NGN",
            price_breakdown={"total_amount": 11_500},
        )

    monkeypatch.setattr(booking_service, "retrieve_customer_by_id", _stub_retrieve_customer)
    monkeypatch.setattr(booking_service, "retrieve_cleaner_by_id", _stub_retrieve_cleaner)
    monkeypatch.setattr(booking_service, "create_booking", _stub_create_booking)
    monkeypatch.setattr(booking_service, "create_payment_for_booking", _stub_create_payment_for_booking)
    monkeypatch.setattr(booking_service, "calculate_quote_for_booking_id", _stub_calculate_quote_for_booking_id)
    monkeypatch.setattr(booking_service, "update_booking_fields", _stub_update_booking_fields)

    result = await booking_service.create_booking_for_customer(principal=principal, payload=payload)

    assert result.id == "booking-1"
    assert result.payment_id == "payment-1"
    assert result.price_amount_minor == 11_500
    assert result.price_currency == "NGN"


@pytest.mark.asyncio
async def test_create_booking_for_customer_rolls_back_when_payment_creation_fails(
    monkeypatch: pytest.MonkeyPatch,
):
    payload = _booking_payload()
    principal = _principal()
    deleted_booking_ids: list[str] = []

    async def _stub_create_booking(_booking_create):
        return _booking_out(id="booking-rollback")

    async def _stub_create_payment_for_booking(*, booking_id: str):
        assert booking_id == "booking-rollback"
        raise RuntimeError("payment provider unavailable")

    async def _stub_delete_booking(*, booking_id: str):
        deleted_booking_ids.append(booking_id)
        return None

    async def _stub_retrieve_customer(**_kwargs):
        return None

    async def _stub_retrieve_cleaner(**_kwargs):
        return None

    monkeypatch.setattr(booking_service, "retrieve_customer_by_id", _stub_retrieve_customer)
    monkeypatch.setattr(booking_service, "retrieve_cleaner_by_id", _stub_retrieve_cleaner)
    monkeypatch.setattr(booking_service, "create_booking", _stub_create_booking)
    monkeypatch.setattr(booking_service, "create_payment_for_booking", _stub_create_payment_for_booking)
    monkeypatch.setattr(booking_service, "delete_booking", _stub_delete_booking)

    with pytest.raises(RuntimeError):
        await booking_service.create_booking_for_customer(principal=principal, payload=payload)

    assert deleted_booking_ids == ["booking-rollback"]


@pytest.mark.asyncio
async def test_create_booking_for_customer_rejects_customer_id_mismatch():
    payload = _booking_payload(customer_id="customer-2")
    principal = _principal(user_id="customer-1")

    with pytest.raises(AppException) as exc_info:
        await booking_service.create_booking_for_customer(principal=principal, payload=payload)

    exc = exc_info.value
    assert exc.status_code == 403
    assert exc.detail["code"] == ErrorCode.AUTH_PERMISSION_DENIED.value


@pytest.mark.asyncio
async def test_accept_booking_rejects_pending_payment_when_required(monkeypatch: pytest.MonkeyPatch):
    principal = _principal(role="cleaner", user_id="cleaner-1")
    booking = _booking_out(payment_id="payment-1")

    async def _stub_retrieve_booking_by_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return booking

    async def _stub_get_payment_transaction(*, payment_id: str):
        assert payment_id == "payment-1"
        return SimpleNamespace(status="pending")

    monkeypatch.setattr(booking_service, "retrieve_booking_by_id", _stub_retrieve_booking_by_id)
    monkeypatch.setattr(booking_service, "get_payment_transaction", _stub_get_payment_transaction)

    with pytest.raises(AppException) as exc_info:
        await booking_service.accept_booking(
            booking_id="booking-1",
            principal=principal,
            allow_pending_payment=False,
        )

    exc = exc_info.value
    assert exc.status_code == 409
    assert exc.detail["code"] == ErrorCode.VALIDATION_FAILED.value
    assert exc.detail["details"]["payment_status"] == "pending"


@pytest.mark.asyncio
async def test_accept_booking_transitions_status_after_successful_payment(
    monkeypatch: pytest.MonkeyPatch,
):
    principal = _principal(role="cleaner", user_id="cleaner-1")
    booking = _booking_out(payment_id="payment-1")

    async def _stub_retrieve_booking_by_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return booking

    async def _stub_get_payment_transaction(*, payment_id: str):
        assert payment_id == "payment-1"
        return SimpleNamespace(status="succeeded")

    async def _stub_transition_booking_status(*, booking_id: str, expected_status: str, update_dict: dict):
        assert booking_id == "booking-1"
        assert expected_status == BookingStatus.REQUESTED.value
        assert update_dict["status"] == BookingStatus.ACCEPTED.value
        return _booking_out(status=BookingStatus.ACCEPTED, payment_id="payment-1")

    monkeypatch.setattr(booking_service, "retrieve_booking_by_id", _stub_retrieve_booking_by_id)
    monkeypatch.setattr(booking_service, "get_payment_transaction", _stub_get_payment_transaction)
    monkeypatch.setattr(booking_service, "transition_booking_status", _stub_transition_booking_status)

    result = await booking_service.accept_booking(
        booking_id="booking-1",
        principal=principal,
        allow_pending_payment=False,
    )

    assert result.status == BookingStatus.ACCEPTED
