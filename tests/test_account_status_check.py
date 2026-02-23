import pytest
from starlette.requests import Request

from core.errors import AppException, ErrorCode
from security.account_status_check import check_user_account_status_and_permissions
from security.principal import AuthPrincipal


def _make_request(path: str = "/") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "scheme": "http",
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_check_user_account_status_dispatches_cleaner(monkeypatch: pytest.MonkeyPatch):
    async def _stub_non_admin_check(*, request: Request, principal: AuthPrincipal, role: str):
        return {"user_id": principal.user_id, "role": role}

    monkeypatch.setattr(
        "security.account_status_check._check_non_admin_account_status_and_permissions",
        _stub_non_admin_check,
    )

    principal = AuthPrincipal(
        user_id="cleaner-1",
        role="cleaner",
        access_token_id="access-1",
        jwt_token="jwt-1",
    )

    result = await check_user_account_status_and_permissions(
        request=_make_request("/cleaners/me"),
        principal=principal,
    )
    assert result == {"user_id": "cleaner-1", "role": "cleaner"}


@pytest.mark.asyncio
async def test_check_user_account_status_dispatches_customer(monkeypatch: pytest.MonkeyPatch):
    async def _stub_non_admin_check(*, request: Request, principal: AuthPrincipal, role: str):
        return {"user_id": principal.user_id, "role": role}

    monkeypatch.setattr(
        "security.account_status_check._check_non_admin_account_status_and_permissions",
        _stub_non_admin_check,
    )

    principal = AuthPrincipal(
        user_id="customer-1",
        role="customer",
        access_token_id="access-1",
        jwt_token="jwt-1",
    )

    result = await check_user_account_status_and_permissions(
        request=_make_request("/customers/me"),
        principal=principal,
    )
    assert result == {"user_id": "customer-1", "role": "customer"}


@pytest.mark.asyncio
async def test_check_user_account_status_rejects_admin_role():
    principal = AuthPrincipal(
        user_id="admin-1",
        role="admin",
        access_token_id="access-1",
        jwt_token="jwt-1",
    )

    with pytest.raises(AppException) as exc_info:
        await check_user_account_status_and_permissions(
            request=_make_request("/admins/profile"),
            principal=principal,
        )

    exc = exc_info.value
    assert getattr(exc, "status_code", None) == 403
    assert exc.detail["code"] == ErrorCode.AUTH_ROLE_MISMATCH.value
    assert exc.detail["details"]["required_role"] == "cleaner|customer"
    assert exc.detail["details"]["actual_role"] == "admin"
