from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.v1 import admin_route
from security.account_status_check import check_admin_account_status_and_permissions


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")
    app.dependency_overrides[check_admin_account_status_and_permissions] = (
        lambda: SimpleNamespace(id="admin-1", email="admin@example.com")
    )
    return app


def test_monitoring_overview_route_returns_enveloped_payload(monkeypatch: pytest.MonkeyPatch):
    async def _stub_get_monitoring_overview():
        return {
            "login_failures_last_hour": 2,
            "login_success_last_hour": 4,
            "refresh_failures_last_hour": 1,
            "open_alert_count": 3,
            "high_alert_count": 1,
            "critical_alert_count": 1,
            "active_admin_sessions": 2,
            "suspicious_login_successes_last_day": 1,
        }

    monkeypatch.setattr(admin_route, "get_monitoring_overview", _stub_get_monitoring_overview)
    client = TestClient(_build_app())

    response = client.get("/v1/admins/monitoring/overview")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["open_alert_count"] == 3


def test_monitoring_alert_read_route_returns_404_when_missing(monkeypatch: pytest.MonkeyPatch):
    async def _stub_set_alert_read_state(*, alert_id: str, payload):
        _ = alert_id, payload
        return None

    monkeypatch.setattr(admin_route, "set_alert_read_state", _stub_set_alert_read_state)
    client = TestClient(_build_app())

    response = client.patch("/v1/admins/monitoring/alerts/67e0f0f0f0f0f0f0f0f0f0f0/read", json={"is_read": True})
    assert response.status_code == 404


def test_login_route_logs_failure_attempt(monkeypatch: pytest.MonkeyPatch):
    async def _stub_authenticate_admin(*, admin_data):
        _ = admin_data
        raise HTTPException(status_code=401, detail="Invalid credentials")

    calls: list[dict[str, object]] = []

    async def _stub_log_admin_login_attempt(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(admin_route, "authenticate_admin", _stub_authenticate_admin)
    monkeypatch.setattr(admin_route, "log_admin_login_attempt", _stub_log_admin_login_attempt)

    client = TestClient(_build_app())
    response = client.post(
        "/v1/admins/login",
        json={"email": "admin@example.com", "password": "wrong-pass"},
    )

    assert response.status_code == 401
    assert len(calls) == 1
    assert calls[0]["success"] is False
    assert calls[0]["status_code"] == 401


def test_refresh_route_logs_failure(monkeypatch: pytest.MonkeyPatch):
    async def _stub_refresh_admin_tokens_reduce_number_of_logins(*, admin_refresh_data, expired_access_token):
        _ = admin_refresh_data, expired_access_token
        raise HTTPException(status_code=404, detail="Invalid refresh token")

    calls: list[dict[str, object]] = []

    async def _stub_log_admin_refresh_attempt(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(
        admin_route,
        "refresh_admin_tokens_reduce_number_of_logins",
        _stub_refresh_admin_tokens_reduce_number_of_logins,
    )
    monkeypatch.setattr(admin_route, "log_admin_refresh_attempt", _stub_log_admin_refresh_attempt)

    client = TestClient(_build_app())

    response = client.post(
        "/v1/admins/refresh",
        json={"refresh_token": "invalid"},
    )

    assert response.status_code == 404
    assert len(calls) == 1
    assert calls[0]["success"] is False
    assert calls[0]["invalid_refresh_reuse"] is True
