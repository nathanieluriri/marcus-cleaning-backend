from __future__ import annotations

from types import SimpleNamespace

import jwt
import pytest
from bson import ObjectId

from repositories import tokens_repo
from security import auth0_verifier


@pytest.mark.asyncio
async def test_auth0_verifier_allows_missing_nbf_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth0_verifier,
        "get_settings",
        lambda: SimpleNamespace(
            auth0_issuer="https://example.us.auth0.com/",
            auth0_domain="example.us.auth0.com",
            auth0_audience="https://api.example",
            auth0_allowed_azp=(),
            auth0_http_timeout_seconds=5,
            auth0_jwks_cache_ttl_seconds=300,
        ),
    )

    verifier = auth0_verifier.Auth0TokenVerifier()

    async def _stub_public_key(*, kid: str):
        _ = kid
        return "public-key"

    monkeypatch.setattr(verifier, "_get_public_key", _stub_public_key)
    monkeypatch.setattr(auth0_verifier.jwt, "get_unverified_header", lambda _token: {"alg": "RS256", "kid": "kid-1"})

    monkeypatch.setattr(
        auth0_verifier.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "auth0|abc123",
            "iss": "https://example.us.auth0.com/",
            "aud": "https://api.example",
            "iat": 1710000000,
            "exp": 1710003600,
        },
    )

    claims = await verifier.verify_access_token("header.payload.signature")
    assert claims.sub == "auth0|abc123"
    assert claims.nbf is None


@pytest.mark.asyncio
async def test_resolve_access_token_id_accepts_object_id() -> None:
    token_id = str(ObjectId())
    assert await tokens_repo._resolve_access_token_id(accessToken=token_id, allow_expired=False) == token_id


@pytest.mark.asyncio
async def test_resolve_access_token_id_rejects_non_object_id() -> None:
    assert await tokens_repo._resolve_access_token_id(accessToken="legacy.jwt.token", allow_expired=False) is None


@pytest.mark.asyncio
async def test_resolve_access_token_id_accepts_jwt_wrapped_object_id(monkeypatch: pytest.MonkeyPatch) -> None:
    token_id = str(ObjectId())

    async def _stub_decode_jwt_token(*, token: str):
        _ = token
        return {"accessToken": token_id}

    monkeypatch.setattr(tokens_repo, "decode_jwt_token", _stub_decode_jwt_token)
    assert await tokens_repo._resolve_access_token_id(accessToken="jwt.token.value", allow_expired=False) == token_id


@pytest.mark.asyncio
async def test_resolve_access_token_id_accepts_expired_jwt_when_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    token_id = str(ObjectId())

    async def _stub_decode_jwt_without_exp(*, token: str):
        _ = token
        return {"accessToken": token_id}

    monkeypatch.setattr(tokens_repo, "decode_jwt_token_without_expiration", _stub_decode_jwt_without_exp)
    assert await tokens_repo._resolve_access_token_id(accessToken="expired.jwt.token", allow_expired=True) == token_id
