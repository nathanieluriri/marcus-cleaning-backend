from __future__ import annotations

from typing import Final

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.errors import auth_invalid_token, auth_role_mismatch
from repositories.tokens_repo import get_access_token, get_access_token_allow_expired
from security.principal import AuthPrincipal


token_auth_scheme = HTTPBearer(auto_error=True)
AUTH_ROLES: Final[tuple[str, ...]] = ('cleaner', 'customer', 'admin',)
NON_ADMIN_ROLES: Final[tuple[str, ...]] = ('cleaner', 'customer',)
LEGACY_ROLE_ALIASES: Final[dict[str, str]] = {"member": "user"}


def _normalize_role(role: str | None) -> str:
    value = (role or "").lower()
    return LEGACY_ROLE_ALIASES.get(value, value)


async def _resolve_principal(
    credentials: HTTPAuthorizationCredentials,
    *,
    allow_expired: bool,
) -> AuthPrincipal:
    getter = get_access_token_allow_expired if allow_expired else get_access_token
    token_record = await getter(accessToken=credentials.credentials)
    if token_record is None:
        raise auth_invalid_token()

    role = _normalize_role(token_record.role)
    if role not in AUTH_ROLES:
        raise auth_invalid_token(details={"role": token_record.role})

    return AuthPrincipal(
        user_id=token_record.userId,
        role=role,
        access_token_id=token_record.accesstoken,
        jwt_token=credentials.credentials,
        token_created_at=token_record.dateCreated,
        allow_expired=allow_expired,
    )


async def verify_any_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await _resolve_principal(credentials, allow_expired=False)


async def verify_cleaner_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    principal = await _resolve_principal(credentials, allow_expired=False)
    if principal.role != "cleaner":
        raise auth_role_mismatch(required_role="cleaner", actual_role=principal.role)
    return principal
async def verify_customer_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    principal = await _resolve_principal(credentials, allow_expired=False)
    if principal.role != "customer":
        raise auth_role_mismatch(required_role="customer", actual_role=principal.role)
    return principal


async def verify_admin_token(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    principal = await _resolve_principal(credentials, allow_expired=False)
    if principal.role != "admin":
        raise auth_role_mismatch(required_role="admin", actual_role=principal.role)
    return principal


async def verify_token_to_refresh(
    credentials: HTTPAuthorizationCredentials = Depends(token_auth_scheme),
) -> AuthPrincipal:
    return await _resolve_principal(credentials, allow_expired=True)


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


# Backward-compatible aliases
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
