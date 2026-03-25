from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import booking_route
from schemas.booking import BookingHistoryScheduledSort, BookingHistoryScope, BookingPaymentStatus
from security.booking_access_check import require_booking_principal, require_customer_principal
from security.principal import AuthPrincipal


def _principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="customer-1",
        role="customer",
        access_token_id="access-1",
        jwt_token="jwt-1",
    )


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(booking_route.router, prefix="/v1")
    app.dependency_overrides[require_booking_principal] = _principal
    app.dependency_overrides[require_customer_principal] = _principal
    return app


def test_booking_history_route_accepts_snake_case_filters(monkeypatch):
    captured: dict = {}

    async def _stub_retrieve_bookings_for_principal(**kwargs):
        captured.update(kwargs)
        return {"items": [], "nextCursor": None}

    monkeypatch.setattr(booking_route, "retrieve_bookings_for_principal", _stub_retrieve_bookings_for_principal)

    client = TestClient(_build_app())
    response = client.get(
        "/v1/bookings",
        params={
            "scope": "upcoming",
            "payment_status": "pending",
            "cursor": "12",
            "page_size": 5,
            "scheduled_sort": "asc",
        },
    )

    assert response.status_code == 200
    assert captured["scope"] == BookingHistoryScope.UPCOMING
    assert captured["payment_status"] == BookingPaymentStatus.PENDING
    assert captured["cursor"] == "12"
    assert captured["page_size"] == 5
    assert captured["scheduled_sort"] == BookingHistoryScheduledSort.ASC


def test_booking_history_route_accepts_camel_case_filters(monkeypatch):
    captured: dict = {}

    async def _stub_retrieve_bookings_for_principal(**kwargs):
        captured.update(kwargs)
        return {"items": [], "nextCursor": None}

    monkeypatch.setattr(booking_route, "retrieve_bookings_for_principal", _stub_retrieve_bookings_for_principal)

    client = TestClient(_build_app())
    response = client.get(
        "/v1/bookings",
        params={
            "scope": "past",
            "paymentStatus": "succeeded",
            "cursor": "3",
            "pageSize": 2,
            "scheduledSort": "desc",
        },
    )

    assert response.status_code == 200
    assert captured["scope"] == BookingHistoryScope.PAST
    assert captured["payment_status"] == BookingPaymentStatus.SUCCEEDED
    assert captured["cursor"] == "3"
    assert captured["page_size"] == 2
    assert captured["scheduled_sort"] == BookingHistoryScheduledSort.DESC


def test_booking_history_route_accepts_expected_sort_alias(monkeypatch):
    captured: dict = {}

    async def _stub_retrieve_bookings_for_principal(**kwargs):
        captured.update(kwargs)
        return {"items": [], "nextCursor": None}

    monkeypatch.setattr(booking_route, "retrieve_bookings_for_principal", _stub_retrieve_bookings_for_principal)

    client = TestClient(_build_app())
    response = client.get(
        "/v1/bookings",
        params={
            "scope": "current",
            "sort": "scheduledAt_desc",
        },
    )

    assert response.status_code == 200
    assert captured["scope"] == BookingHistoryScope.CURRENT
    assert captured["scheduled_sort"] == BookingHistoryScheduledSort.DESC


def test_mark_booking_paid_endpoints_call_service(monkeypatch):
    async def _stub_mark_booking_paid_by_customer(*, booking_id: str, principal):
        assert booking_id == "booking-1"
        assert principal.user_id == "customer-1"
        return {"id": booking_id, "paymentStatus": "paid", "updatedAt": "2026-03-22T00:00:00+00:00"}

    monkeypatch.setattr(booking_route, "mark_booking_paid_by_customer", _stub_mark_booking_paid_by_customer)

    client = TestClient(_build_app())
    post_response = client.post("/v1/bookings/booking-1/payments/mark-paid")
    patch_response = client.patch("/v1/bookings/booking-1/payments/mark-paid")

    assert post_response.status_code == 200
    assert patch_response.status_code == 200
    assert post_response.json()["data"]["paymentStatus"] == "paid"
    assert patch_response.json()["data"]["paymentStatus"] == "paid"


def test_rate_booking_endpoint_calls_service(monkeypatch):
    async def _stub_rate_booking_by_customer(*, booking_id: str, principal, rating: int, comment: str):
        assert booking_id == "booking-1"
        assert principal.user_id == "customer-1"
        assert rating == 5
        assert comment == "Very clean service"
        return {
            "id": booking_id,
            "isRated": True,
            "customerRating": rating,
            "customerComment": comment,
            "updatedAt": "2026-03-22T00:00:00+00:00",
        }

    monkeypatch.setattr(booking_route, "rate_booking_by_customer", _stub_rate_booking_by_customer)

    client = TestClient(_build_app())
    response = client.post(
        "/v1/bookings/booking-1/ratings",
        json={"rating": 5, "comment": "Very clean service"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["isRated"] is True
