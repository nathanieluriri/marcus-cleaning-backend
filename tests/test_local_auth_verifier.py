from __future__ import annotations

import time
from types import SimpleNamespace

import pytest
from fastapi.security import HTTPAuthorizationCredentials

from security import auth


@pytest.mark.asyncio
async def test_verify_cleaner_token_uses_local_token_repo(monkeypatch: pytest.MonkeyPatch) -> None:
    now = int(time.time())

    async def _stub_get_access_token(*, accessToken: str, allow_expired: bool = False):
        _ = allow_expired
        assert accessToken == "jwt-token"
        return SimpleNamespace(
            role="cleaner",
            userId="cleaner-1",
            accesstoken="access-token-id",
            dateCreated=now,
        )

    async def _stub_retrieve_account_by_id(*, role: str, user_id: str):
        assert role == "cleaner"
        assert user_id == "cleaner-1"
        return SimpleNamespace(last_auth_at=now)

    monkeypatch.setattr(auth, "get_access_token", _stub_get_access_token)
    monkeypatch.setattr(auth, "retrieve_account_by_id", _stub_retrieve_account_by_id)

    principal = await auth.verify_cleaner_token(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="jwt-token")
    )

    assert principal.role == "cleaner"
    assert principal.user_id == "cleaner-1"
    assert principal.auth_provider == "local"


@pytest.mark.asyncio
async def test_verify_any_token_falls_back_to_admin_auth0(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_get_access_token(*, accessToken: str, allow_expired: bool = False):
        _ = accessToken, allow_expired
        return None

    async def _stub_verify_admin_auth0(credentials, *, allow_expired: bool = False):
        _ = credentials, allow_expired
        return SimpleNamespace(role="admin", user_id="admin-1", auth_provider="auth0")

    monkeypatch.setattr(auth, "get_access_token", _stub_get_access_token)
    monkeypatch.setattr(auth, "_verify_admin_auth0", _stub_verify_admin_auth0)

    principal = await auth.verify_any_token(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="auth0-token")
    )
    assert principal.role == "admin"
    assert principal.auth_provider == "auth0"
