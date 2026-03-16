from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any

import jwt
import requests
from jwt.algorithms import RSAAlgorithm

from core.settings import get_settings


class Auth0TokenValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Auth0Claims:
    sub: str
    email: str | None
    email_verified: bool
    iss: str
    aud: list[str]
    azp: str | None
    scopes: tuple[str, ...]
    iat: int | None
    exp: int | None
    nbf: int | None
    jti: str | None
    role_hint: str | None
    raw: dict[str, Any]


class Auth0TokenVerifier:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._jwks_cache: dict[str, Any] = {}
        self._jwks_cache_expires_at: float = 0
        self._refresh_lock = asyncio.Lock()

    def _required_issuer(self) -> str:
        if self._settings.auth0_issuer:
            return self._settings.auth0_issuer
        if self._settings.auth0_domain:
            return f"https://{self._settings.auth0_domain}/"
        raise Auth0TokenValidationError("Auth0 issuer/domain is not configured")

    def _required_audience(self) -> str:
        if not self._settings.auth0_audience:
            raise Auth0TokenValidationError("Auth0 audience is not configured")
        return self._settings.auth0_audience

    def _jwks_url(self) -> str:
        issuer = self._required_issuer().rstrip("/")
        return f"{issuer}/.well-known/jwks.json"

    def _is_cache_fresh(self) -> bool:
        return bool(self._jwks_cache) and (time.time() < self._jwks_cache_expires_at)

    async def _refresh_jwks(self) -> None:
        async with self._refresh_lock:
            if self._is_cache_fresh():
                return
            payload = await asyncio.to_thread(self._fetch_jwks)
            keys = payload.get("keys")
            if not isinstance(keys, list):
                raise Auth0TokenValidationError("Invalid JWKS payload")

            parsed: dict[str, Any] = {}
            for item in keys:
                if not isinstance(item, dict):
                    continue
                kid = str(item.get("kid") or "").strip()
                kty = str(item.get("kty") or "").strip().upper()
                if not kid or kty != "RSA":
                    continue
                try:
                    parsed[kid] = RSAAlgorithm.from_jwk(json.dumps(item))
                except Exception:
                    continue

            if not parsed:
                raise Auth0TokenValidationError("No usable RSA keys from JWKS")
            self._jwks_cache = parsed
            self._jwks_cache_expires_at = time.time() + self._settings.auth0_jwks_cache_ttl_seconds

    def _fetch_jwks(self) -> dict[str, Any]:
        try:
            response = requests.get(
                self._jwks_url(),
                timeout=self._settings.auth0_http_timeout_seconds,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise Auth0TokenValidationError("Invalid JWKS response")
            return payload
        except requests.RequestException as err:
            raise Auth0TokenValidationError(f"Failed to fetch JWKS: {err}") from err

    async def _get_public_key(self, *, kid: str) -> Any:
        if self._is_cache_fresh() and kid in self._jwks_cache:
            return self._jwks_cache[kid]

        # Key miss/stale cache: refresh and fail closed if still unresolved.
        await self._refresh_jwks()
        key = self._jwks_cache.get(kid)
        if key is None:
            asyncio.create_task(self._refresh_jwks())
            raise Auth0TokenValidationError("Signing key not found for token kid")
        return key

    def _coerce_scopes(self, raw_claims: dict[str, Any]) -> tuple[str, ...]:
        scope_value = raw_claims.get("scope")
        if not scope_value:
            return tuple()
        if isinstance(scope_value, str):
            return tuple(item for item in scope_value.split(" ") if item)
        return tuple()

    def _role_hint(self, raw_claims: dict[str, Any]) -> str | None:
        _ = raw_claims
        # Auth0 is auth-only in this backend. Role authority is local.
        return None

    def _validate_azp(self, raw_claims: dict[str, Any]) -> str | None:
        azp = raw_claims.get("azp") or raw_claims.get("client_id")
        if azp is None:
            return None
        azp_value = str(azp).strip()
        if not azp_value:
            return None
        if self._settings.auth0_allowed_azp and azp_value not in set(self._settings.auth0_allowed_azp):
            raise Auth0TokenValidationError("Token authorized party is not allowed")
        return azp_value

    async def verify_access_token(self, token: str) -> Auth0Claims:
        if not token or not token.strip():
            raise Auth0TokenValidationError("Empty bearer token")

        try:
            headers = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError as err:
            raise Auth0TokenValidationError("Malformed JWT header") from err

        alg = str(headers.get("alg") or "")
        kid = str(headers.get("kid") or "")
        if alg != "RS256":
            raise Auth0TokenValidationError("Unsupported JWT algorithm")
        if not kid:
            raise Auth0TokenValidationError("Missing JWT key id")

        public_key = await self._get_public_key(kid=kid)
        issuer = self._required_issuer()
        audience = self._required_audience()
        leeway_seconds = 5

        try:
            raw_claims = jwt.decode(
                token,
                key=public_key,
                algorithms=["RS256"],
                audience=audience,
                issuer=issuer,
                options={
                    "require": ["sub", "exp", "iat", "nbf"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_nbf": True,
                },
                leeway=leeway_seconds,
            )
        except jwt.InvalidTokenError as err:
            raise Auth0TokenValidationError(f"Invalid token claims: {err}") from err

        sub = str(raw_claims.get("sub") or "").strip()
        if not sub:
            raise Auth0TokenValidationError("Missing subject claim")

        audience_claim = raw_claims.get("aud")
        audiences: list[str]
        if isinstance(audience_claim, str):
            audiences = [audience_claim]
        elif isinstance(audience_claim, list):
            audiences = [str(item) for item in audience_claim]
        else:
            audiences = []

        azp = self._validate_azp(raw_claims)
        scopes = self._coerce_scopes(raw_claims)

        email = raw_claims.get("email")
        return Auth0Claims(
            sub=sub,
            email=str(email) if isinstance(email, str) else None,
            email_verified=bool(raw_claims.get("email_verified")),
            iss=str(raw_claims.get("iss") or ""),
            aud=audiences,
            azp=azp,
            scopes=scopes,
            iat=int(raw_claims.get("iat")) if raw_claims.get("iat") is not None else None,
            exp=int(raw_claims.get("exp")) if raw_claims.get("exp") is not None else None,
            nbf=int(raw_claims.get("nbf")) if raw_claims.get("nbf") is not None else None,
            jti=str(raw_claims.get("jti")) if raw_claims.get("jti") else None,
            role_hint=self._role_hint(raw_claims),
            raw=raw_claims,
        )


_VERIFIER: Auth0TokenVerifier | None = None


def get_auth0_token_verifier() -> Auth0TokenVerifier:
    global _VERIFIER
    if _VERIFIER is None:
        _VERIFIER = Auth0TokenVerifier()
    return _VERIFIER


def build_access_token_id(*, token: str, claims: Auth0Claims) -> str:
    if claims.jti:
        return claims.jti
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return digest[:24]
