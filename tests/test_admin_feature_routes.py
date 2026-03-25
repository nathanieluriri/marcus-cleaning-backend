from __future__ import annotations

import time
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import admin_route
from api.v1.admin_features import concierge_booking as concierge_booking_route
from security.account_status_check import check_admin_account_status_and_permissions
from security.permissions import default_get_permissions, default_permissions


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")
    app.dependency_overrides[check_admin_account_status_and_permissions] = (
        lambda: SimpleNamespace(id="admin-1", email="admin@example.com")
    )
    return app


def test_admin_feature_routes_are_exposed_in_permission_catalog() -> None:
    permissions = default_get_permissions()
    keys = {permission.key for permission in permissions.permissions}

    expected_get_keys = {
        "GET:/admins/service-definitions",
        "GET:/admins/add-ons",
        "GET:/admins/pricing-rules",
        "GET:/admins/service-areas",
        "GET:/admins/cleaner-tags",
        "GET:/admins/availability-overrides",
        "GET:/admins/promo-codes",
        "GET:/admins/service-credits",
        "GET:/admins/payout-adjustments",
        "GET:/admins/chat-interventions",
        "GET:/admins/broadcasts",
        "GET:/admins/concierge-bookings",
        "GET:/admins/claim-reviews",
        "GET:/admins/users/autocomplete",
        "GET:/admins/customers/{customer_id}/places",
    }

    for expected in expected_get_keys:
        assert expected in keys

    # Guard key catalog continuity across both existing and newly added admin routes.
    assert "GET:/admins/customers" in keys
    assert "GET:/admins/service-definitions" in keys


def test_admin_customer_places_create_route_exposed_in_permission_catalog() -> None:
    permissions = default_permissions()
    keys = {permission.key for permission in permissions.permissions}
    assert "POST:/admins/customers/{customer_id}/places" in keys


def test_admin_can_create_concierge_booking_on_behalf(monkeypatch) -> None:
    async def _stub_create_concierge_booking_for_admin(*, admin_id: str, payload, note: str | None):
        assert admin_id == "admin-1"
        assert payload.customer_id == "customer-1"
        assert payload.cleaner_id == "cleaner-1"
        assert note == "VIP concierge"
        return (
            {"id": "booking-1", "customer_id": "customer-1", "cleaner_id": "cleaner-1"},
            {"id": "concierge-1", "booking_id": "booking-1", "status": "created"},
        )

    monkeypatch.setattr(
        concierge_booking_route,
        "create_concierge_booking_for_admin",
        _stub_create_concierge_booking_for_admin,
    )

    client = TestClient(_build_app())
    response = client.post(
        "/v1/admins/concierge-bookings/create-booking?note=VIP concierge",
        json={
            "customer_id": "customer-1",
            "place_id": "place-1",
            "cleaner_id": "cleaner-1",
            "schedule": int(time.time()) + 7200,
            "extras": {"add_ons": []},
            "service": "STANDARD",
            "duration": {"hours": 2, "minutes": 0},
            "custom_details": None,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["booking"]["id"] == "booking-1"
    assert payload["data"]["concierge_record"]["id"] == "concierge-1"
