from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import admin_route
from schemas.admin_schema import AdminBase
from schemas.imports import AccountStatus
from security.account_status_check import check_admin_account_status_and_permissions
from security.auth0_client import Auth0TokenSet
from services import admin_service


@pytest.mark.asyncio
async def test_authenticate_admin_auto_provisions_local_admin_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_password_login(*, email: str, password: str) -> Auth0TokenSet:
        assert email == "newadmin@example.com"
        assert password == "Secret#12345"
        return Auth0TokenSet(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            token_type="Bearer",
            id_token=None,
        )

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|new-admin", email="newadmin@example.com", email_verified=True, iat=1700000000)

    async def _stub_resolve_role_account_for_claims(*_args, **_kwargs):
        return None

    async def _stub_create_admin(payload):
        assert payload.auth_subject == "auth0|new-admin"
        keys = {perm.key for perm in payload.permissionList.permissions}
        assert "GET:/admins/profile" in keys
        assert "POST:/admins/access/request-elevation" in keys
        assert "GET:/admins/access/request-elevation/status" in keys
        return SimpleNamespace(
            id="admin-100",
            email=payload.email,
            password=payload.password,
            permissionList=payload.permissionList,
            access_token=None,
            refresh_token=None,
        )

    monkeypatch.setattr(admin_service, "password_login", _stub_password_login)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(admin_service, "create_admin", _stub_create_admin)

    result = await admin_service.authenticate_admin(
        AdminBase(
            full_name="New Admin",
            email="newadmin@example.com",
            password="Secret#12345",
        )
    )

    assert result.id == "admin-100"
    assert result.password == ""
    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"


@pytest.mark.asyncio
async def test_authenticate_admin_auto_provisions_with_login_email_when_token_email_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _stub_password_login(*, email: str, password: str) -> Auth0TokenSet:
        assert email == "fallback@example.com"
        assert password == "Secret#12345"
        return Auth0TokenSet(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            token_type="Bearer",
            id_token=None,
        )

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|missing-email", email=None, email_verified=False, iat=1700000000)

    async def _stub_resolve_role_account_for_claims(*_args, **_kwargs):
        return None

    async def _stub_create_admin(payload):
        assert payload.email == "fallback@example.com"
        return SimpleNamespace(
            id="admin-110",
            email=payload.email,
            password=payload.password,
            permissionList=payload.permissionList,
            access_token=None,
            refresh_token=None,
        )

    monkeypatch.setattr(admin_service, "password_login", _stub_password_login)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(admin_service, "create_admin", _stub_create_admin)

    result = await admin_service.authenticate_admin(
        AdminBase(
            full_name="Fallback Admin",
            email="fallback@example.com",
            password="Secret#12345",
        )
    )

    assert result.id == "admin-110"
    assert result.password == ""
    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"


@pytest.mark.asyncio
async def test_authenticate_admin_does_not_register_non_super_admin_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_password_login(*, email: str, password: str) -> Auth0TokenSet:
        return Auth0TokenSet(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            token_type="Bearer",
            id_token=None,
        )

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|normal-admin", email="normal@example.com", email_verified=True, iat=1700000000)

    async def _stub_resolve_role_account_for_claims(*_args, **_kwargs):
        return SimpleNamespace(id="admin-1")

    async def _stub_refresh_account_after_update(*, role: str, user_id: str):
        assert role == "admin"
        assert user_id == "admin-1"
        return SimpleNamespace(id="admin-1", password="hashed", access_token=None, refresh_token=None)

    def _fail_register_super_admin_subject(_subject: str) -> None:
        raise AssertionError("register_super_admin_subject must not run for normal admin login")

    monkeypatch.setattr(admin_service, "password_login", _stub_password_login)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(admin_service, "refresh_account_after_update", _stub_refresh_account_after_update)
    monkeypatch.setattr(admin_service, "register_super_admin_subject", _fail_register_super_admin_subject)

    result = await admin_service.authenticate_admin(
        AdminBase(
            full_name="Normal Admin",
            email="normal@example.com",
            password="Secret#12345",
        )
    )

    assert result.id == "admin-1"
    assert result.password == ""
    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"


@pytest.mark.asyncio
async def test_refresh_admin_tokens_auto_provisions_local_admin_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_refresh_access_token(*, refresh_token: str) -> Auth0TokenSet:
        assert refresh_token == "refresh-token"
        return Auth0TokenSet(
            access_token="refreshed-access",
            refresh_token="refreshed-refresh",
            expires_in=3600,
            token_type="Bearer",
            id_token=None,
        )

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|new-refresh-admin", email="refresh.admin@example.com", email_verified=True, iat=1700000100)

    async def _stub_resolve_role_account_for_claims(*_args, **_kwargs):
        return None

    async def _stub_create_admin(payload):
        assert payload.auth_subject == "auth0|new-refresh-admin"
        return SimpleNamespace(
            id="admin-200",
            email=payload.email,
            password=payload.password,
            permissionList=payload.permissionList,
            access_token=None,
            refresh_token=None,
        )

    monkeypatch.setattr(admin_service, "refresh_access_token", _stub_refresh_access_token)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(admin_service, "create_admin", _stub_create_admin)
    monkeypatch.setattr(admin_service, "is_known_super_admin_subject", lambda _subject: False)

    result = await admin_service.refresh_admin_tokens_reduce_number_of_logins(
        admin_refresh_data=SimpleNamespace(refresh_token="refresh-token"),
        expired_access_token="expired",
    )

    assert result.id == "admin-200"
    assert result.password == ""
    assert result.access_token == "refreshed-access"
    assert result.refresh_token == "refreshed-refresh"


def test_admin_can_submit_elevation_request_with_minimal_permissions(monkeypatch: pytest.MonkeyPatch) -> None:
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")

    app.dependency_overrides[check_admin_account_status_and_permissions] = lambda: SimpleNamespace(
        id="admin-1",
        accountStatus=AccountStatus.ACTIVE,
    )

    async def _stub_submit_admin_elevation_request(
        *,
        admin_id: str,
        reason: str,
        requested_permissions: list[str] | None,
        requested_permission_groups: list[str] | None,
    ):
        assert admin_id == "admin-1"
        assert reason == "Need access to manage service definitions and pricing"
        assert requested_permissions == ["GET:/admins/service-definitions", "POST:/admins/pricing-rules"]
        assert requested_permission_groups == []
        return {"requestId": "req-1", "status": "PENDING", "message": "Elevation request submitted"}

    monkeypatch.setattr(admin_route, "submit_admin_elevation_request", _stub_submit_admin_elevation_request)

    client = TestClient(app)
    response = client.post(
        "/v1/admins/access/request-elevation",
        json={
            "reason": "Need access to manage service definitions and pricing",
            "requestedPermissions": ["GET:/admins/service-definitions", "POST:/admins/pricing-rules"],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["status"] == "PENDING"
