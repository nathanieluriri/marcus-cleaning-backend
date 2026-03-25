from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from core.settings import get_settings
from repositories.tokens_repo import (
    delete_current_session_with_access_token_id,
    delete_other_tokens_with_user_id,
)
from security.auth0_client import Auth0APIError, revoke_all_refresh_tokens_for_subject


@dataclass(frozen=True)
class SessionCounts:
    active: int
    revocable: int


async def _count_documents(collection: Any, filter_dict: dict[str, Any]) -> int:
    if hasattr(collection, "count_documents"):
        return int(await collection.count_documents(filter_dict))

    if hasattr(collection, "find"):
        rows = await collection.find(filter_dict)
        return len(rows)

    return 0


async def get_session_counts(*, user_id: str, current_access_token_id: str | None) -> SessionCounts:
    from core.database import db

    access_collection = getattr(db, "accessToken", None)
    if access_collection is None:
        return SessionCounts(active=0, revocable=0)

    active = await _count_documents(access_collection, {"userId": user_id})
    if active <= 0:
        return SessionCounts(active=0, revocable=0)

    revocable = max(active - 1, 0) if current_access_token_id else active
    return SessionCounts(active=active, revocable=revocable)


async def revoke_other_sessions(*, user_id: str, current_access_token_id: str) -> tuple[int, int]:
    return await delete_other_tokens_with_user_id(
        user_id=user_id,
        current_access_token_id=current_access_token_id,
    )


async def revoke_current_session(
    *,
    user_id: str,
    current_access_token_id: str,
    auth_subject: str | None = None,
    auth_provider: str = "auth0",
) -> tuple[int, int]:
    await _revoke_auth0_sessions_if_enabled(auth_subject=auth_subject, auth_provider=auth_provider)
    return await delete_current_session_with_access_token_id(
        user_id=user_id,
        access_token_id=current_access_token_id,
    )


async def _revoke_auth0_sessions_if_enabled(*, auth_subject: str | None, auth_provider: str) -> None:
    settings = get_settings()
    if not settings.auth0_revoke_sessions_enabled:
        return
    if auth_provider != "auth0":
        return
    subject = (auth_subject or "").strip()
    if not subject:
        raise Auth0APIError(message="Auth0 session revocation enabled but auth subject is missing")
    await revoke_all_refresh_tokens_for_subject(auth_subject=subject)


async def revoke_all_sessions(
    *,
    user_id: str,
    auth_subject: str | None = None,
    auth_provider: str = "auth0",
) -> tuple[int, int]:
    await _revoke_auth0_sessions_if_enabled(auth_subject=auth_subject, auth_provider=auth_provider)

    from core.database import db

    refresh_result = await db.refreshToken.delete_many(filter={"userId": user_id})
    access_result = await db.accessToken.delete_many(filter={"userId": user_id})
    return access_result.deleted_count, refresh_result.deleted_count
