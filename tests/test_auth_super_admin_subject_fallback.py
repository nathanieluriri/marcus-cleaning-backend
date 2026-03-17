from __future__ import annotations

import pytest
from fastapi.security import HTTPAuthorizationCredentials

from security import auth as auth_module
from security.auth0_verifier import Auth0Claims
from services.super_admin_identity_service import SUPER_ADMIN_STATIC_ID


@pytest.mark.asyncio
async def test_verify_admin_token_allows_known_super_admin_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    claims = Auth0Claims(
        sub="auth0|super-admin-subject",
        email="uririnathaniel@gmail.com",
        email_verified=True,
        iss="https://dev-wqymqi02el6sa5o7.us.auth0.com/",
        aud=["https://api.marcus-cleaning"],
        azp="0PiRBr0SSFNKCmRJdJVbQlvb0zOjcvod",
        scopes=("openid", "profile", "email"),
        iat=1700000000,
        exp=1700003600,
        nbf=None,
        jti=None,
        role_hint=None,
        raw={},
    )

    async def _stub_verify_claims(_credentials: HTTPAuthorizationCredentials) -> Auth0Claims:
        return claims

    async def _stub_resolve_role_account_for_claims(*, role: str, claims: Auth0Claims):
        _ = role
        _ = claims
        return None

    monkeypatch.setattr(auth_module, "_verify_claims", _stub_verify_claims)
    monkeypatch.setattr(auth_module, "resolve_role_account_for_claims", _stub_resolve_role_account_for_claims)
    monkeypatch.setattr(auth_module, "is_known_super_admin_subject", lambda _subject: True)

    principal = await auth_module.verify_admin_token(
        credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="jwt-token")
    )

    assert principal.role == "admin"
    assert principal.user_id == SUPER_ADMIN_STATIC_ID
