from __future__ import annotations

import time
from typing import Final

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.errors import auth_invalid_token, auth_role_mismatch
from core.settings import get_settings
from security.auth0_verifier import (
    Auth0Claims,
    Auth0TokenValidationError,
    build_access_token_id,
    get_auth0_token_verifier,
)
from security.principal import AuthPrincipal
from services.auth_identity_service import resolve_any_role_account_for_claims, resolve_role_account_for_claims

token_auth_scheme = HTTPBearer(auto_error=True)
AUTH_ROLES: Final[tuple[str, ...]] = ("cleaner", "customer", "admin")
_SETTINGS = get_settings()


async def _verify_claims(credentials: HTTPAuthorizationCredentials) -> Auth0Claims:
    try:
        verifier = get_auth0_token_verifier()
        return await verifier.verify_access_token(credentials.credentials)
    except Auth0TokenValidationError as err:
        raise auth_invalid_token(details={"reason": str(err)}) from err


def _build_principal(
    *,
    claims: Auth0Claims,
    credentials: HTTPAuthorizationCredentials,
    role: str,
    user_id: str,
    allow_expired: bool = False,
) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=user_id,
        role=role,  # type: ignore[arg-type]
        access_token_id=build_access_token_id(token=credentials.credentials, claims=claims),
        jwt_token=credentials.credentials,
        auth_subject=claims.sub,
        auth_provider="auth0",
        scopes=claims.scopes,
        token_created_at=claims.iat,
        allow_expired=allow_expired,
    )


def _session_max_age_seconds(role: str) -> int:
    if role == "admin":
        return _SETTINGS.auth_session_max_age_admin_seconds
    if role == "cleaner":
        return _SETTINGS.auth_session_max_age_cleaner_seconds
    return _SETTINGS.auth_session_max_age_customer_seconds


def _session_idle_timeout_seconds(role: str) -> int:
    if role == "admin":
        return _SETTINGS.auth_session_idle_timeout_admin_seconds
    if role == "cleaner":
        return _SETTINGS.auth_session_idle_timeout_cleaner_seconds
    return _SETTINGS.auth_session_idle_timeout_customer_seconds


def _enforce_session_policy(*, role: str, claims: Auth0Claims, account: object) -> None:
    now = int(time.time())

    token_iat = claims.iat
    if isinstance(token_iat, int):
        max_age = _session_max_age_seconds(role)
        if now - token_iat > max_age:
            raise auth_invalid_token(
                details={"reason": "Session max lifetime exceeded", "role": role, "max_age_seconds": max_age}
            )

    last_auth_at = getattr(account, "last_auth_at", None)
    if isinstance(last_auth_at, int):
        idle_timeout = _session_idle_timeout_seconds(role)
        if now - last_auth_at > idle_timeout:
            raise auth_invalid_token(
                details={"reason": "Session idle timeout exceeded", "role": role, "idle_timeout_seconds": idle_timeout}
            )


async def verify_any_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    claims = await _verify_claims(credentials)
    resolved_role, account = await resolve_any_role_account_for_claims(claims=claims)
    if not account or not resolved_role:
        raise auth_invalid_token(details={"reason": "No local account is linked to this identity"})
    _enforce_session_policy(role=resolved_role, claims=claims, account=account)
    return _build_principal(
        claims=claims,
        credentials=credentials,
        role=resolved_role,
        user_id=str(account.id),  # type: ignore[arg-type]
    )


async def verify_cleaner_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    claims = await _verify_claims(credentials)
    account = await resolve_role_account_for_claims(role="cleaner", claims=claims)
    if account is None:
        raise auth_role_mismatch(required_role="cleaner", actual_role=None)
    _enforce_session_policy(role="cleaner", claims=claims, account=account)
    return _build_principal(
        claims=claims,
        credentials=credentials,
        role="cleaner",
        user_id=str(account.id),  # type: ignore[arg-type]
    )


async def verify_customer_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    claims = await _verify_claims(credentials)
    account = await resolve_role_account_for_claims(role="customer", claims=claims)
    if account is None:
        raise auth_role_mismatch(required_role="customer", actual_role=None)
    _enforce_session_policy(role="customer", claims=claims, account=account)
    return _build_principal(
        claims=claims,
        credentials=credentials,
        role="customer",
        user_id=str(account.id),  # type: ignore[arg-type]
    )


async def verify_admin_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    claims = await _verify_claims(credentials)
    account = await resolve_role_account_for_claims(role="admin", claims=claims)
    if account is None:
        raise auth_role_mismatch(required_role="admin", actual_role=None)
    _enforce_session_policy(role="admin", claims=claims, account=account)
    return _build_principal(
        claims=claims,
        credentials=credentials,
        role="admin",
        user_id=str(account.id),  # type: ignore[arg-type]
    )


async def verify_token_to_refresh(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await verify_any_token(credentials)


async def verify_cleaner_refresh_token(
    principal: AuthPrincipal = Depends(verify_token_to_refresh),
) -> AuthPrincipal:
    if principal.role != "cleaner":
        raise auth_role_mismatch(required_role="cleaner", actual_role=principal.role)
    return principal


async def verify_customer_refresh_token(
    principal: AuthPrincipal = Depends(verify_token_to_refresh),
) -> AuthPrincipal:
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)
    return principal


async def verify_admin_refresh_token(
    principal: AuthPrincipal = Depends(verify_token_to_refresh),
) -> AuthPrincipal:
    if principal.role != "admin":
        raise auth_role_mismatch(required_role="admin", actual_role=principal.role)
    return principal


async def verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await verify_cleaner_token(credentials)


async def verify_member_refresh_token(
    principal: AuthPrincipal = Depends(verify_token_to_refresh),
) -> AuthPrincipal:
    return await verify_cleaner_refresh_token(principal)


async def verify_token_user_role(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await verify_token(credentials)


async def verify_admin_token_otp(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await verify_admin_token(credentials)
