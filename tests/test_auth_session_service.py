from __future__ import annotations

from types import SimpleNamespace

import pytest

from services import auth_session_service


class _FakeCollection:
    def __init__(self, count: int):
        self._count = count

    async def count_documents(self, _filter: dict) -> int:
        return self._count


@pytest.mark.asyncio
async def test_get_session_counts_with_current_session(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_db = SimpleNamespace(accessToken=_FakeCollection(4))

    import core.database as database_module

    monkeypatch.setattr(database_module, "db", fake_db)
    counts = await auth_session_service.get_session_counts(user_id="user-1", current_access_token_id="token-1")

    assert counts.active == 4
    assert counts.revocable == 3


@pytest.mark.asyncio
async def test_get_session_counts_missing_collection(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_db = SimpleNamespace()

    import core.database as database_module

    monkeypatch.setattr(database_module, "db", fake_db)
    counts = await auth_session_service.get_session_counts(user_id="user-1", current_access_token_id=None)

    assert counts.active == 0
    assert counts.revocable == 0


@pytest.mark.asyncio
async def test_revoke_all_sessions_enforces_auth_subject_when_provider_revocation_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_session_service,
        "get_settings",
        lambda: SimpleNamespace(auth0_revoke_sessions_enabled=True),
    )

    with pytest.raises(Exception) as exc_info:
        await auth_session_service.revoke_all_sessions(user_id="user-1", auth_subject=None)

    assert "auth subject is missing" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_revoke_current_session_skips_provider_call_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        auth_session_service,
        "get_settings",
        lambda: SimpleNamespace(auth0_revoke_sessions_enabled=False),
    )

    async def _stub_delete_current_session_with_access_token_id(*, user_id: str, access_token_id: str) -> tuple[int, int]:
        assert user_id == "user-1"
        assert access_token_id == "token-1"
        return 1, 1

    monkeypatch.setattr(
        auth_session_service,
        "delete_current_session_with_access_token_id",
        _stub_delete_current_session_with_access_token_id,
    )

    access_deleted, refresh_deleted = await auth_session_service.revoke_current_session(
        user_id="user-1",
        current_access_token_id="token-1",
        auth_subject=None,
    )

    assert access_deleted == 1
    assert refresh_deleted == 1
