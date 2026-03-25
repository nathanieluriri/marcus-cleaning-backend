from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from core.errors import AppException, ErrorCode
from schemas.booking import (
    BookingBase,
    BookingCustomerCreateRequest,
    BookingHistoryScheduledSort,
    BookingHistoryScope,
    BookingOut,
    BookingPaymentStatus,
)
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


def _booking_payload() -> BookingCustomerCreateRequest:
    return BookingCustomerCreateRequest(
        place_id="place-1",
        cleaner_id="cleaner-1",
        schedule=int(time.time()) + 7_200,
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
        "schedule": int(time.time()) + 7_200,
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
async def test_create_booking_for_customer_uses_authenticated_customer_id(monkeypatch: pytest.MonkeyPatch):
    payload = _booking_payload()
    principal = _principal(user_id="customer-1")

    async def _stub_retrieve_customer(*, id: str):
        assert id == "customer-1"
        return SimpleNamespace(id=id)

    async def _stub_retrieve_cleaner(**_kwargs):
        return SimpleNamespace(id="cleaner-1")

    async def _stub_create_booking(booking_create):
        assert booking_create.customer_id == "customer-1"
        return _booking_out(id="booking-token-derived")

    async def _stub_create_payment_for_booking(*, booking_id: str):
        return SimpleNamespace(id=f"payment-{booking_id}")

    async def _stub_calculate_quote_for_booking_id(*, booking_id: str):
        return SimpleNamespace(amount_minor=1000, currency="NGN", breakdown={"total_amount": 1000})

    async def _stub_update_booking_fields(*, booking_id: str, update_dict: dict):
        return _booking_out(id=booking_id, payment_id=update_dict["payment_id"])

    monkeypatch.setattr(booking_service, "retrieve_customer_by_id", _stub_retrieve_customer)
    monkeypatch.setattr(booking_service, "retrieve_cleaner_by_id", _stub_retrieve_cleaner)
    monkeypatch.setattr(booking_service, "create_booking", _stub_create_booking)
    monkeypatch.setattr(booking_service, "create_payment_for_booking", _stub_create_payment_for_booking)
    monkeypatch.setattr(booking_service, "calculate_quote_for_booking_id", _stub_calculate_quote_for_booking_id)
    monkeypatch.setattr(booking_service, "update_booking_fields", _stub_update_booking_fields)

    result = await booking_service.create_booking_for_customer(principal=principal, payload=payload)
    assert result.id == "booking-token-derived"


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


@pytest.mark.asyncio
async def test_retrieve_bookings_for_principal_returns_cursor_page(monkeypatch: pytest.MonkeyPatch):
    principal = _principal(role="customer", user_id="customer-1")
    captured: dict = {}

    async def _stub_get_bookings_history(**kwargs):
        captured.update(kwargs)
        return [_booking_out(id="booking-1"), _booking_out(id="booking-2")]

    monkeypatch.setattr(booking_service, "get_bookings_history", _stub_get_bookings_history)

    result = await booking_service.retrieve_bookings_for_principal(
        principal=principal,
        status_filter=BookingStatus.REQUESTED,
        scope=BookingHistoryScope.UPCOMING,
        payment_status=BookingPaymentStatus.PENDING,
        cursor="5",
        page_size=1,
        scheduled_sort=BookingHistoryScheduledSort.ASC,
    )

    assert captured["filter_dict"]["customer_id"] == "customer-1"
    assert captured["filter_dict"]["status"] == BookingStatus.REQUESTED.value
    assert captured["scope"] == BookingHistoryScope.UPCOMING.value
    assert captured["payment_status"] == BookingPaymentStatus.PENDING.value
    assert captured["cursor_offset"] == 5
    assert captured["page_size"] == 1
    assert captured["scheduled_sort"] == BookingHistoryScheduledSort.ASC.value
    assert len(result.items) == 1
    assert result.items[0].id == "booking-1"
    assert result.nextCursor == "6"


@pytest.mark.asyncio
async def test_retrieve_bookings_for_principal_rejects_invalid_cursor():
    principal = _principal(role="customer", user_id="customer-1")

    with pytest.raises(AppException) as exc_info:
        await booking_service.retrieve_bookings_for_principal(
            principal=principal,
            cursor="invalid-cursor",
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.detail["code"] == ErrorCode.VALIDATION_FAILED.value


@pytest.mark.asyncio
async def test_mark_booking_paid_by_customer_is_idempotent_when_already_paid(monkeypatch: pytest.MonkeyPatch):
    principal = _principal(role="customer", user_id="customer-1")
    booking = _booking_out(id="booking-1", customer_id="customer-1", payment_id="payment-1")

    async def _stub_retrieve_booking_by_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return booking

    async def _stub_get_payment_transaction(*, payment_id: str):
        assert payment_id == "payment-1"
        return SimpleNamespace(status="succeeded", updated_at=int(time.time()), reference="ref-1", response_payload={})

    monkeypatch.setattr(booking_service, "retrieve_booking_by_id", _stub_retrieve_booking_by_id)
    monkeypatch.setattr(booking_service, "get_payment_transaction", _stub_get_payment_transaction)

    result = await booking_service.mark_booking_paid_by_customer(booking_id="booking-1", principal=principal)

    assert result["id"] == "booking-1"
    assert result["paymentStatus"] == "paid"


@pytest.mark.asyncio
async def test_mark_booking_paid_by_customer_updates_pending_payment(monkeypatch: pytest.MonkeyPatch):
    principal = _principal(role="customer", user_id="customer-1")
    booking = _booking_out(id="booking-1", customer_id="customer-1", payment_id="payment-1")

    async def _stub_retrieve_booking_by_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return booking

    async def _stub_get_payment_transaction(*, payment_id: str):
        assert payment_id == "payment-1"
        return SimpleNamespace(status="pending", updated_at=int(time.time()), reference="ref-1", response_payload={})

    async def _stub_update_payment_transaction_status(*, reference: str, status: str, response_payload: dict):
        assert reference == "ref-1"
        assert status == "succeeded"
        _ = response_payload
        return SimpleNamespace(updated_at=int(time.time()))

    monkeypatch.setattr(booking_service, "retrieve_booking_by_id", _stub_retrieve_booking_by_id)
    monkeypatch.setattr(booking_service, "get_payment_transaction", _stub_get_payment_transaction)
    monkeypatch.setattr(booking_service, "update_payment_transaction_status", _stub_update_payment_transaction_status)

    result = await booking_service.mark_booking_paid_by_customer(booking_id="booking-1", principal=principal)

    assert result["paymentStatus"] == "paid"


@pytest.mark.asyncio
async def test_rate_booking_by_customer_creates_review(monkeypatch: pytest.MonkeyPatch):
    principal = _principal(role="customer", user_id="customer-1")
    booking = _booking_out(
        id="booking-1",
        customer_id="customer-1",
        cleaner_id="cleaner-1",
        status=BookingStatus.CLEANER_COMPLETED,
    )

    async def _stub_retrieve_booking_by_id(*, booking_id: str):
        assert booking_id == "booking-1"
        return booking

    class _StubReviewsCollection:
        async def find_one(self, query: dict):
            assert query["customer_id"] == "customer-1"
            assert query["booking_id"] == "booking-1"
            return None

    async def _stub_add_review(payload):
        assert payload.customer_id == "customer-1"
        assert payload.booking_id == "booking-1"
        assert payload.cleaner_id == "cleaner-1"
        assert payload.stars == 5
        assert payload.comment == "Very clean service"
        return SimpleNamespace(stars=5, comment="Very clean service", last_updated=int(time.time()))

    monkeypatch.setattr(booking_service, "retrieve_booking_by_id", _stub_retrieve_booking_by_id)
    monkeypatch.setattr(booking_service, "db", SimpleNamespace(reviews=_StubReviewsCollection()))
    monkeypatch.setattr(booking_service, "add_review", _stub_add_review)

    result = await booking_service.rate_booking_by_customer(
        booking_id="booking-1",
        principal=principal,
        rating=5,
        comment="Very clean service",
    )

    assert result["isRated"] is True
    assert result["customerRating"] == 5
