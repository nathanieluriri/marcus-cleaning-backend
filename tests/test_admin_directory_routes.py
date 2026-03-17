from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.v1 import admin_route
from schemas.imports import AccountStatus, OnboardingStatus
from security.account_status_check import check_admin_account_status_and_permissions
from security.permissions import default_get_permissions


def _build_app(*, override_exception: HTTPException | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")

    if override_exception is None:
        app.dependency_overrides[check_admin_account_status_and_permissions] = (
            lambda: SimpleNamespace(id="admin-1", email="admin@example.com")
        )
    else:
        async def _raise_override():
            raise override_exception

        app.dependency_overrides[check_admin_account_status_and_permissions] = _raise_override
    return app


def test_admin_customers_route_success(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_admin_customers(
        *,
        start: int,
        stop: int,
        search: str | None,
        account_status,
        from_epoch: int | None,
        to_epoch: int | None,
    ):
        assert start == 0
        assert stop == 50
        assert search is None
        assert account_status is None
        assert from_epoch is None
        assert to_epoch is None
        return [
            {
                "id": "67f0f0f0f0f0f0f0f0f0f0f1",
                "_id": "67f0f0f0f0f0f0f0f0f0f0f1",
                "firstName": "Jane",
                "lastName": "Doe",
                "email": "jane@example.com",
                "phoneNumber": None,
                "accountStatus": AccountStatus.ACTIVE.value,
                "date_created": 1,
                "last_updated": 2,
            }
        ]

    monkeypatch.setattr(admin_route, "retrieve_admin_customers", _stub_retrieve_admin_customers)
    client = TestClient(_build_app())

    response = client.get("/v1/admins/customers?start=0&stop=50")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["message"] == "Customers fetched successfully"
    assert payload["data"][0]["id"] == payload["data"][0]["_id"]


def test_admin_cleaners_route_success_with_filter(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_admin_cleaners(*, start: int, stop: int, onboarding_status):
        assert start == 1
        assert stop == 20
        assert onboarding_status == OnboardingStatus.PENDING
        return [
            {
                "id": "67f0f0f0f0f0f0f0f0f0f0f2",
                "_id": "67f0f0f0f0f0f0f0f0f0f0f2",
                "firstName": "John",
                "lastName": "Cleaner",
                "email": "john@example.com",
                "accountStatus": AccountStatus.ACTIVE.value,
                "onboarding_status": OnboardingStatus.PENDING.value,
                "rejection_reason": None,
                "date_created": 1,
                "last_updated": 2,
            }
        ]

    monkeypatch.setattr(admin_route, "retrieve_admin_cleaners", _stub_retrieve_admin_cleaners)
    client = TestClient(_build_app())

    response = client.get("/v1/admins/cleaners?onboarding_status=PENDING&start=1&stop=20")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["onboarding_status"] == "PENDING"


def test_admin_cleaners_route_rejects_invalid_stop_cap():
    client = TestClient(_build_app())
    response = client.get("/v1/admins/cleaners?start=0&stop=500")
    assert response.status_code == 422


def test_admin_cleaner_detail_route_success(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_admin_cleaner_detail(*, cleaner_id: str):
        assert cleaner_id == "67f0f0f0f0f0f0f0f0f0f0f2"
        return {
            "id": cleaner_id,
            "_id": cleaner_id,
            "firstName": "John",
            "lastName": "Cleaner",
            "email": "john@example.com",
            "accountStatus": AccountStatus.ACTIVE.value,
            "onboarding_status": OnboardingStatus.PENDING.value,
            "rejection_reason": None,
            "date_created": 1,
            "last_updated": 2,
            "profile": {"location": {"place_id": "abc"}},
        }

    monkeypatch.setattr(admin_route, "retrieve_admin_cleaner_detail", _stub_retrieve_admin_cleaner_detail)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/cleaners/67f0f0f0f0f0f0f0f0f0f0f2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["id"] == payload["data"]["_id"]
    assert payload["data"]["profile"]["location"]["place_id"] == "abc"


def test_admin_cleaner_detail_route_not_found(monkeypatch: pytest.MonkeyPatch):
    async def _stub_retrieve_admin_cleaner_detail(*, cleaner_id: str):
        _ = cleaner_id
        raise HTTPException(status_code=404, detail="Cleaner not found")

    monkeypatch.setattr(admin_route, "retrieve_admin_cleaner_detail", _stub_retrieve_admin_cleaner_detail)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/cleaners/67f0f0f0f0f0f0f0f0f0f0f2")
    assert response.status_code == 404


def test_admin_customers_route_returns_401_when_unauthorized():
    client = TestClient(_build_app(override_exception=HTTPException(status_code=401, detail="Unauthorized")))
    response = client.get("/v1/admins/customers")
    assert response.status_code == 401


def test_admin_cleaners_route_returns_403_when_permission_denied():
    client = TestClient(_build_app(override_exception=HTTPException(status_code=403, detail="Permission denied")))
    response = client.get("/v1/admins/cleaners")
    assert response.status_code == 403


def test_new_admin_directory_routes_are_in_permission_catalog():
    permissions = default_get_permissions()
    keys = {permission.key for permission in permissions.permissions}
    assert "GET:/admins/customers" in keys
    assert "GET:/admins/customers/{customer_id}" in keys
    assert "GET:/admins/cleaners" in keys
    assert "GET:/admins/cleaners/{cleaner_id}" in keys
    assert "GET:/admins/onboarding/queue" in keys
