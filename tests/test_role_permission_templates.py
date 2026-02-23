import pytest
from pydantic import ValidationError

from core.errors import AppException, ErrorCode
from schemas.cleaner_schema import CleanerSignupRequest
from schemas.customer_schema import CustomerSignupRequest
from security.default_role_permissions import get_default_permission_list_for_role
from services.role_permission_template_service import (
    get_effective_permission_list_for_role,
    set_role_permission_template_for_role,
)


def test_cleaner_signup_request_forbids_permission_fields():
    with pytest.raises(ValidationError):
        CleanerSignupRequest(
            firstName="Jane",
            lastName="Doe",
            loginType="EMAIL",
            email="jane@example.com",
            password="secret",
            permissionList={"permissions": []},
            accountStatus="SUSPENDED",
        )


def test_customer_signup_request_forbids_permission_fields():
    with pytest.raises(ValidationError):
        CustomerSignupRequest(
            firstName="John",
            lastName="Doe",
            loginType="EMAIL",
            email="john@example.com",
            password="secret",
            permissionList={"permissions": []},
            accountStatus="INACTIVE",
        )


def test_default_permission_list_returns_copy():
    first = get_default_permission_list_for_role("cleaner")
    first.permissions.append(
        first.permissions[0].model_copy(update={"key": "GET:/cleaners/unsafe"})
    )
    second = get_default_permission_list_for_role("cleaner")

    keys = {permission.key for permission in second.permissions}
    assert "GET:/cleaners/unsafe" not in keys
    assert "GET:/cleaners/me" in keys


@pytest.mark.asyncio
async def test_effective_permission_list_rejects_unsupported_role():
    with pytest.raises(AppException) as exc_info:
        await get_effective_permission_list_for_role("admin")

    assert exc_info.value.detail["code"] == ErrorCode.VALIDATION_FAILED.value


@pytest.mark.asyncio
async def test_set_template_requires_admin_id():
    default_permissions = get_default_permission_list_for_role("customer")

    with pytest.raises(AppException) as exc_info:
        await set_role_permission_template_for_role(
            role="customer",
            permission_list=default_permissions,
            admin_id="",
        )

    assert exc_info.value.detail["code"] == ErrorCode.VALIDATION_FAILED.value
