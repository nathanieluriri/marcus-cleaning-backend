from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from security.auth0_client import Auth0APIError
from services import admin_service


@pytest.mark.asyncio
async def test_remove_admin_with_auth0_deletes_local_when_auth0_user_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_retrieve_admin_by_admin_id(*, id: str):
        return SimpleNamespace(
            id=id,
            email="admin@example.com",
            auth_subject="auth0|missing-user",
        )

    async def _stub_delete_auth0_user(*, auth_subject: str):
        assert auth_subject == "auth0|missing-user"
        return "not_found"

    async def _stub_delete_admin(_filter_dict):
        return SimpleNamespace(deleted_count=1)

    monkeypatch.setattr(admin_service, "retrieve_admin_by_admin_id", _stub_retrieve_admin_by_admin_id)
    monkeypatch.setattr(admin_service, "delete_auth0_user", _stub_delete_auth0_user)
    monkeypatch.setattr(admin_service, "delete_admin", _stub_delete_admin)

    result = await admin_service.remove_admin_with_auth0(admin_id="67f0f0f0f0f0f0f0f0f0f0f2")
    assert result["deleted"] is True
    assert result["auth0Status"] == "not_found"


@pytest.mark.asyncio
async def test_remove_admin_with_auth0_stops_local_delete_when_auth0_delete_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_retrieve_admin_by_admin_id(*, id: str):
        return SimpleNamespace(
            id=id,
            email="admin@example.com",
            auth_subject="auth0|existing-user",
        )

    async def _stub_delete_auth0_user(*, auth_subject: str):
        _ = auth_subject
        raise Auth0APIError(
            message="Auth0 delete failed",
            status_code=500,
            details={"message": "upstream_error"},
        )

    async def _stub_delete_admin(_filter_dict):
        raise AssertionError("local delete must not run when Auth0 delete fails")

    monkeypatch.setattr(admin_service, "retrieve_admin_by_admin_id", _stub_retrieve_admin_by_admin_id)
    monkeypatch.setattr(admin_service, "delete_auth0_user", _stub_delete_auth0_user)
    monkeypatch.setattr(admin_service, "delete_admin", _stub_delete_admin)

    with pytest.raises(HTTPException) as exc:
        await admin_service.remove_admin_with_auth0(admin_id="67f0f0f0f0f0f0f0f0f0f0f2")
    assert exc.value.status_code == 502
    assert exc.value.detail["code"] == "AUTH0_DELETE_FAILED"


@pytest.mark.asyncio
async def test_remove_admin_with_auth0_blocks_main_super_admin_target(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_retrieve_admin_by_admin_id(*, id: str):
        return SimpleNamespace(
            id=admin_service.SUPER_ADMIN_STATIC_ID,
            email="super-admin@example.com",
            auth_subject="auth0|super",
        )

    monkeypatch.setattr(admin_service, "retrieve_admin_by_admin_id", _stub_retrieve_admin_by_admin_id)

    with pytest.raises(HTTPException) as exc:
        await admin_service.remove_admin_with_auth0(admin_id="67f0f0f0f0f0f0f0f0f0f0f2")
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "ADMIN_DELETE_FORBIDDEN"
