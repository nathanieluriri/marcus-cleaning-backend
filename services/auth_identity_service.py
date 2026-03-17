from __future__ import annotations

import logging
import time
from typing import Literal

from fastapi import HTTPException, status

from security.auth0_verifier import Auth0Claims
from services.role_account_gateway import (
    find_account_by_email,
    find_account_by_subject,
    retrieve_account_by_id,
    update_auth_identity_fields,
)

logger = logging.getLogger(__name__)
RoleName = Literal["admin", "cleaner", "customer"]


async def _find_by_subject(role: RoleName, subject: str):
    return await find_account_by_subject(role=role, subject=subject)


async def _find_by_email(role: RoleName, email: str):
    return await find_account_by_email(role=role, email=email)


def _auth_updates(*, claims: Auth0Claims) -> dict[str, object]:
    return {
        "auth_provider": "auth0",
        "auth_subject": claims.sub,
        "email_verified": claims.email_verified,
        "last_auth_at": int(time.time()),
    }


def _should_touch_account(account: object, claims: Auth0Claims) -> bool:
    current_verified = bool(getattr(account, "email_verified", False))
    current_subject = getattr(account, "auth_subject", None)
    last_auth_at = getattr(account, "last_auth_at", None)
    if current_subject != claims.sub:
        return True
    if current_verified != claims.email_verified:
        return True
    if not isinstance(last_auth_at, int):
        return True
    return (int(time.time()) - last_auth_at) >= 300


async def _apply_auth_updates(role: RoleName, user_id: str, claims: Auth0Claims):
    updates = _auth_updates(claims=claims)
    return await update_auth_identity_fields(
        role=role,
        user_id=user_id,
        auth_provider=str(updates["auth_provider"]),
        auth_subject=str(updates["auth_subject"]),
        email_verified=bool(updates["email_verified"]),
        last_auth_at=int(updates["last_auth_at"]),
    )


async def resolve_role_account_for_claims(
    *,
    role: RoleName,
    claims: Auth0Claims,
):
    logger.info(
        "Resolve role account started role=%s subject=%s has_email=%s email_verified=%s",
        role,
        claims.sub,
        bool(claims.email),
        claims.email_verified,
    )
    by_subject = await _find_by_subject(role=role, subject=claims.sub)
    if by_subject is not None:
        logger.info("Resolve role account matched by subject role=%s account_id=%s", role, getattr(by_subject, "id", None))
        if _should_touch_account(by_subject, claims):
            await _apply_auth_updates(role=role, user_id=str(by_subject.id), claims=claims)  # type: ignore[arg-type]
        return by_subject

    # Email linking guardrail: only link if verified email and account is currently unbound.
    if claims.email and claims.email_verified:
        by_email = await _find_by_email(role=role, email=claims.email)
        if by_email is not None:
            logger.info("Resolve role account matched by email role=%s account_id=%s", role, getattr(by_email, "id", None))
            existing_subject = getattr(by_email, "auth_subject", None)
            if existing_subject and existing_subject != claims.sub:
                logger.warning(
                    "Resolve role account conflict role=%s existing_subject=%s incoming_subject=%s",
                    role,
                    existing_subject,
                    claims.sub,
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"{role.capitalize()} account is already linked to another identity",
                )
            await _apply_auth_updates(role=role, user_id=str(by_email.id), claims=claims)  # type: ignore[arg-type]
            return by_email
        logger.info("Resolve role account email lookup miss role=%s email=%s", role, claims.email)
    else:
        logger.info(
            "Resolve role account skipped email lookup role=%s has_email=%s email_verified=%s",
            role,
            bool(claims.email),
            claims.email_verified,
        )

    logger.info("Resolve role account not found role=%s subject=%s", role, claims.sub)
    return None


async def resolve_any_role_account_for_claims(*, claims: Auth0Claims):
    candidates: list[tuple[RoleName, object]] = []
    for role in ("admin", "cleaner", "customer"):
        account = await resolve_role_account_for_claims(role=role, claims=claims)
        if account is not None:
            candidates.append((role, account))

    if len(candidates) == 1:
        return candidates[0]

    if len(candidates) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Identity is linked to multiple local roles; use role-specific endpoint",
        )
    return None, None


async def refresh_account_after_update(*, role: RoleName, user_id: str):
    return await retrieve_account_by_id(role=role, user_id=user_id)
