from __future__ import annotations

import asyncio
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from core.settings import get_settings


class Auth0APIError(RuntimeError):
    def __init__(self, *, message: str, status_code: int | None = None, details: Any | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.details = details


@dataclass(frozen=True)
class Auth0TokenSet:
    access_token: str
    refresh_token: str | None
    expires_in: int
    token_type: str
    id_token: str | None

    @property
    def expires_at(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(seconds=max(self.expires_in, 0))


def _require_auth0_config() -> tuple[str, str, str]:
    settings = get_settings()
    if not settings.auth0_domain or not settings.auth0_client_id or not settings.auth0_client_secret:
        raise Auth0APIError(message="Auth0 client configuration is missing")
    return settings.auth0_domain, settings.auth0_client_id, settings.auth0_client_secret


def _oauth_token_url(domain: str) -> str:
    return f"https://{domain}/oauth/token"


def _signup_url(domain: str) -> str:
    return f"https://{domain}/dbconnections/signup"


def _auth0_management_api_audience(domain: str) -> str:
    return f"https://{domain}/api/v2/"


def _timeout_seconds() -> int:
    return get_settings().auth0_http_timeout_seconds


def _parse_token_response(payload: dict[str, Any]) -> Auth0TokenSet:
    access_token = str(payload.get("access_token") or "")
    if not access_token:
        raise Auth0APIError(message="Auth0 token response missing access_token", details=payload)
    return Auth0TokenSet(
        access_token=access_token,
        refresh_token=payload.get("refresh_token"),
        expires_in=int(payload.get("expires_in") or 0),
        token_type=str(payload.get("token_type") or "Bearer"),
        id_token=payload.get("id_token"),
    )


def _request_json(*, method: str, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.request(
            method=method,
            url=url,
            json=payload,
            timeout=_timeout_seconds(),
            headers={"Content-Type": "application/json"},
        )
    except requests.RequestException as err:
        raise Auth0APIError(message="Failed to reach Auth0", details=str(err)) from err

    data: dict[str, Any]
    try:
        data = response.json() if response.content else {}
    except ValueError:
        data = {}

    if response.status_code >= 400:
        message = str(data.get("error_description") or data.get("error") or "Auth0 request failed")
        raise Auth0APIError(message=message, status_code=response.status_code, details=data)
    return data


async def password_login(*, email: str, password: str) -> Auth0TokenSet:
    domain, client_id, client_secret = _require_auth0_config()
    settings = get_settings()

    payload: dict[str, Any] = {
        "grant_type": "password",
        "username": email,
        "password": password,
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "openid profile email offline_access",
    }
    if settings.auth0_audience:
        payload["audience"] = settings.auth0_audience
    if settings.auth0_db_connection:
        payload["realm"] = settings.auth0_db_connection

    data = await asyncio.to_thread(
        _request_json,
        method="POST",
        url=_oauth_token_url(domain),
        payload=payload,
    )
    return _parse_token_response(data)


async def refresh_access_token(*, refresh_token: str) -> Auth0TokenSet:
    domain, client_id, client_secret = _require_auth0_config()
    settings = get_settings()

    payload: dict[str, Any] = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    if settings.auth0_audience:
        payload["audience"] = settings.auth0_audience

    data = await asyncio.to_thread(
        _request_json,
        method="POST",
        url=_oauth_token_url(domain),
        payload=payload,
    )
    return _parse_token_response(data)


async def signup_email_password(*, email: str, password: str) -> None:
    domain, client_id, _client_secret = _require_auth0_config()
    settings = get_settings()
    if not settings.auth0_db_connection:
        raise Auth0APIError(message="AUTH0_DB_CONNECTION is required for signup")

    payload: dict[str, Any] = {
        "client_id": client_id,
        "email": email,
        "password": password,
        "connection": settings.auth0_db_connection,
    }

    await asyncio.to_thread(
        _request_json,
        method="POST",
        url=_signup_url(domain),
        payload=payload,
    )


def _require_management_config() -> tuple[str, str, str]:
    settings = get_settings()
    if not settings.auth0_domain:
        raise Auth0APIError(message="Auth0 domain is missing")
    client_id = settings.auth0_management_client_id or settings.auth0_client_id
    client_secret = settings.auth0_management_client_secret or settings.auth0_client_secret
    if not client_id or not client_secret:
        raise Auth0APIError(message="Auth0 management API credentials are missing")
    return settings.auth0_domain, client_id, client_secret


def _request_no_content(*, method: str, url: str, token: str) -> None:
    try:
        response = requests.request(
            method=method,
            url=url,
            timeout=_timeout_seconds(),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
    except requests.RequestException as err:
        raise Auth0APIError(message="Failed to reach Auth0 management API", details=str(err)) from err

    if response.status_code in {200, 202, 204}:
        return

    data: dict[str, Any] = {}
    try:
        data = response.json() if response.content else {}
    except ValueError:
        data = {}
    message = str(data.get("message") or data.get("error") or "Auth0 management request failed")
    raise Auth0APIError(message=message, status_code=response.status_code, details=data)


async def management_api_token() -> str:
    domain, client_id, client_secret = _require_management_config()
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "audience": _auth0_management_api_audience(domain),
    }

    data = await asyncio.to_thread(
        _request_json,
        method="POST",
        url=_oauth_token_url(domain),
        payload=payload,
    )
    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise Auth0APIError(message="Auth0 management token response missing access_token", details=data)
    return access_token


async def revoke_all_refresh_tokens_for_subject(*, auth_subject: str) -> None:
    subject = auth_subject.strip()
    if not subject:
        raise Auth0APIError(message="auth_subject is required for Auth0 session revocation")
    settings = get_settings()
    if not settings.auth0_domain:
        raise Auth0APIError(message="Auth0 domain is missing")

    token = await management_api_token()
    encoded_subject = urllib.parse.quote(subject, safe="")
    url = f"https://{settings.auth0_domain}/api/v2/users/{encoded_subject}/refresh-tokens"
    await asyncio.to_thread(
        _request_no_content,
        method="DELETE",
        url=url,
        token=token,
    )
