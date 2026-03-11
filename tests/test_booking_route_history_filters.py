from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import booking_route
from schemas.booking import BookingHistoryScheduledSort, BookingHistoryScope, BookingPaymentStatus
from security.booking_access_check import require_booking_principal
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
