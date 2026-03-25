import pytest
from fastapi import HTTPException
from fastapi import status
from types import SimpleNamespace

from security.auth0_client import Auth0APIError
from services import admin_service
from services.admin_service import _map_auth0_error


def test_map_auth0_invalid_signup_to_400() -> None:
    err = Auth0APIError(
        message="Auth0 request failed",
        status_code=400,
        details={"code": "invalid_signup", "description": "Invalid sign up"},
    )

    mapped = _map_auth0_error(err)
    assert mapped.status_code == status.HTTP_400_BAD_REQUEST
    assert mapped.detail["message"] == "Invalid signup request"
    assert mapped.detail["code"] == "AUTH0_INVALID_SIGNUP"
    assert "hint" in mapped.detail["details"]


def test_map_auth0_invalid_grant_to_401() -> None:
    err = Auth0APIError(
        message="Invalid grant",
        status_code=400,
        details={"error": "invalid_grant", "error_description": "Wrong email or password"},
    )

    mapped = _map_auth0_error(err)
    assert mapped.status_code == status.HTTP_401_UNAUTHORIZED
    assert mapped.detail["message"] == "Invalid email or password"
    assert mapped.detail["code"] == "AUTH0_INVALID_CREDENTIALS"


def test_map_auth0_invalid_signup_existing_identity_to_409() -> None:
    err = Auth0APIError(
        message="Auth0 request failed",
        status_code=400,
        details={"code": "invalid_signup", "description": "User already exists"},
    )
    mapped = _map_auth0_error(err)
    assert mapped.status_code == status.HTTP_409_CONFLICT
    assert mapped.detail["message"] == "Identity already exists in Auth0"
    assert mapped.detail["code"] == "AUTH0_IDENTITY_EXISTS"


@pytest.mark.asyncio
async def test_add_admin_links_existing_auth0_user(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_get_admin(_filter_dict):
        return None

    async def _stub_auth0_user_profile_by_email(*, email: str):
        assert email == "new-admin@example.com"
        return SimpleNamespace(user_id="auth0|abc123", email=email, email_verified=True)

    async def _should_not_signup(*, email: str, password: str):
        _ = email, password
        raise AssertionError("signup_email_password should not be called when Auth0 email already exists")

    async def _stub_create_admin(payload):
        return payload

    monkeypatch.setattr(admin_service, "get_admin", _stub_get_admin)
    monkeypatch.setattr(admin_service, "auth0_user_profile_by_email", _stub_auth0_user_profile_by_email)
    monkeypatch.setattr(admin_service, "signup_email_password", _should_not_signup)
    monkeypatch.setattr(admin_service, "create_admin", _stub_create_admin)

    result = await admin_service.add_admin(
        admin_service.AdminCreate(
            full_name="New Admin",
            email="new-admin@example.com",
            password="Secret#12345",
            invited_by="admin-1",
        )
    )
    assert result.auth_subject == "auth0|abc123"
    assert result.email_verified is True


@pytest.mark.asyncio
async def test_add_admin_updates_existing_local_when_auth0_missing_then_created(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing_local = SimpleNamespace(
        id="67b6fb6fc9ad4ea6aac9aa01",
        email="new-admin@example.com",
        full_name="Old Name",
    )

    async def _stub_auth0_user_profile_by_email(*, email: str):
        assert email == "new-admin@example.com"
        return None

    async def _stub_signup_email_password(*, email: str, password: str):
        assert email == "new-admin@example.com"
        assert password == "Secret#12345"
        return None

    async def _stub_password_login(*, email: str, password: str):
        assert email == "new-admin@example.com"
        assert password == "Secret#12345"
        return SimpleNamespace(access_token="access-token", refresh_token="refresh-token")

    async def _stub_claims_from_access_token(*_args, **_kwargs):
        return SimpleNamespace(sub="auth0|new-id", email="new-admin@example.com", email_verified=True, iat=1700000000)

    async def _stub_get_admin(filter_dict):
        if filter_dict == {"auth_subject": "auth0|new-id"}:
            return None
        if filter_dict == {"email": "new-admin@example.com"}:
            return existing_local
        return None

    async def _stub_update_admin(_filter_dict, payload):
        return SimpleNamespace(
            id="67b6fb6fc9ad4ea6aac9aa01",
            email=payload.email,
            full_name=payload.full_name,
            password=payload.password,
            permissionList=payload.permissionList,
            auth_subject=payload.auth_subject,
            email_verified=payload.email_verified,
            access_token=None,
            refresh_token=None,
        )

    async def _stub_create_admin(_payload):
        raise AssertionError("create_admin should not be called when local admin already exists")

    monkeypatch.setattr(admin_service, "auth0_user_profile_by_email", _stub_auth0_user_profile_by_email)
    monkeypatch.setattr(admin_service, "signup_email_password", _stub_signup_email_password)
    monkeypatch.setattr(admin_service, "password_login", _stub_password_login)
    monkeypatch.setattr(admin_service, "_claims_from_access_token", _stub_claims_from_access_token)
    monkeypatch.setattr(admin_service, "get_admin", _stub_get_admin)
    monkeypatch.setattr(admin_service, "update_admin", _stub_update_admin)
    monkeypatch.setattr(admin_service, "create_admin", _stub_create_admin)

    result = await admin_service.add_admin(
        admin_service.AdminCreate(
            full_name="New Name",
            email="new-admin@example.com",
            password="Secret#12345",
            invited_by="admin-1",
        ),
        raw_password="Secret#12345",
    )

    assert result.id == "67b6fb6fc9ad4ea6aac9aa01"
    assert result.auth_subject == "auth0|new-id"
