from __future__ import annotations

from types import SimpleNamespace

import pytest

from schemas.admin_schema import AdminBase
from schemas.imports import PermissionList
from security.auth0_client import Auth0TokenSet
from services import admin_service


@pytest.mark.asyncio
async def test_authenticate_admin_uses_super_admin_precheck(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPER_ADMIN_EMAIL", "uririnathaniel@gmail.com")
    monkeypatch.setenv("SUPER_ADMIN_PASSWORD", "top-secret")

    async def _stub_password_login(*, email: str, password: str) -> Auth0TokenSet:
        assert email == "uririnathaniel@gmail.com"
        assert password == "top-secret"
        return Auth0TokenSet(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_in=3600,
            token_type="Bearer",
            id_token=None,
        )

    async def _stub_retrieve_admin_by_admin_id(*, id: str):
        assert id == admin_service.SUPER_ADMIN_STATIC_ID
        return SimpleNamespace(
            id=id,
            email="uririnathaniel@gmail.com",
            password="hashed",
            access_token=None,
            refresh_token=None,
        )

    async def _should_not_resolve_role(*_args, **_kwargs):
        raise AssertionError("role resolution should be bypassed for env super admin precheck")

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|super-admin-sub")

    monkeypatch.setattr(admin_service, "password_login", _stub_password_login)
    monkeypatch.setattr(admin_service, "retrieve_admin_by_admin_id", _stub_retrieve_admin_by_admin_id)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _should_not_resolve_role)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)

    result = await admin_service.authenticate_admin(
        AdminBase(
            full_name="Super Admin",
            email="uririnathaniel@gmail.com",
            password="top-secret",
        )
    )

    assert result.id == admin_service.SUPER_ADMIN_STATIC_ID
    assert result.password == ""
    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"


@pytest.mark.asyncio
async def test_refresh_admin_tokens_uses_super_admin_subject_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
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
        return SimpleNamespace(sub="auth0|known-super-admin")

    async def _stub_resolve_role_account_for_claims(*_args, **_kwargs):
        return None

    async def _stub_retrieve_admin_by_admin_id(*, id: str):
        assert id == admin_service.SUPER_ADMIN_STATIC_ID
        return SimpleNamespace(
            id=id,
            email="super-admin@example.com",
            password="hashed",
            access_token=None,
            refresh_token=None,
        )

    monkeypatch.setattr(admin_service, "refresh_access_token", _stub_refresh_access_token)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(admin_service, "retrieve_admin_by_admin_id", _stub_retrieve_admin_by_admin_id)
    monkeypatch.setattr(admin_service, "is_known_super_admin_subject", lambda subject: subject == "auth0|known-super-admin")

    result = await admin_service.refresh_admin_tokens_reduce_number_of_logins(
        admin_refresh_data=SimpleNamespace(refresh_token="refresh-token"),
        expired_access_token="",
    )

    assert result.id == admin_service.SUPER_ADMIN_STATIC_ID
    assert result.password == ""
    assert result.access_token == "refreshed-access"
    assert result.refresh_token == "refreshed-refresh"


@pytest.mark.asyncio
async def test_retrieve_admin_by_admin_id_hydrates_super_admin_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_get_admin(*_args, **_kwargs):
        return SimpleNamespace(
            id=admin_service.SUPER_ADMIN_STATIC_ID,
            full_name="Super Admin",
            email="uririnathaniel@gmail.com",
            password="hashed-password",
            accountStatus="ACTIVE",
            permissionList=None,
            auth_provider=None,
            auth_subject=None,
            email_verified=False,
            last_auth_at=None,
            date_created=None,
            last_updated=None,
            refresh_token=None,
            access_token=None,
        )

    monkeypatch.setattr(admin_service, "get_admin", _stub_get_admin)
    monkeypatch.setattr(admin_service, "default_permissions", lambda: PermissionList(permissions=[]))
    monkeypatch.setattr(admin_service, "get_known_super_admin_subject", lambda: "auth0|super-admin")

    result = await admin_service.retrieve_admin_by_admin_id(id=admin_service.SUPER_ADMIN_STATIC_ID)
    assert result.password == ""
    assert result.permissionList is not None
    assert result.auth_provider == "auth0"
    assert result.auth_subject == "auth0|super-admin"
    assert result.email_verified is True
    assert result.last_auth_at is not None
