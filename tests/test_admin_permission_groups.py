from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from schemas.imports import Permission, PermissionList
from services import admin_service


def _permission(key: str) -> Permission:
    method, path = key.split(":", 1)
    return Permission(name=key, methods=[method], path=path, key=key, description=None)


def _permission_list(keys: list[str]) -> PermissionList:
    return PermissionList(permissions=[_permission(key) for key in keys])


def test_built_in_permission_groups_include_specialized_groups(monkeypatch: pytest.MonkeyPatch) -> None:
    keys = [
        "GET:/admins/concierge-bookings",
        "POST:/admins/concierge-bookings/create-booking",
        "GET:/admins/customers/{customer_id}/places",
        "POST:/admins/customers/{customer_id}/places",
        "GET:/admins/users/autocomplete",
        "GET:/admins/service-definitions",
        "GET:/admins/add-ons",
        "GET:/admins/promo-codes",
        "PATCH:/admins/promo-codes/{id}",
        "GET:/admins/monitoring/overview",
        "POST:/admins/monitoring/audit/export",
        "GET:/admins/reports/users/summary",
        "GET:/admins/permissions/catalog",
        "GET:/admins/profile",
    ]
    monkeypatch.setattr(admin_service, "default_permissions", lambda: _permission_list(keys))

    groups = admin_service._built_in_permission_groups()
    by_name = {group["name"]: group for group in groups}

    assert "admin" in by_name
    assert "super_admin" in by_name
    assert "concierge_operator" in by_name
    assert "promo_handler" in by_name
    assert "monitoring_analyst" in by_name
    assert "audit_compliance_reviewer" in by_name
    assert "reports_viewer" in by_name
    assert "access_reviewer" in by_name

    assert "POST:/admins/concierge-bookings/create-booking" in by_name["concierge_operator"]["permissions"]
    assert "GET:/admins/customers/{customer_id}/places" in by_name["concierge_operator"]["permissions"]
    assert "POST:/admins/customers/{customer_id}/places" in by_name["concierge_operator"]["permissions"]
    assert "GET:/admins/service-definitions" in by_name["concierge_operator"]["permissions"]
    assert "POST:/admins/customers/{customer_id}/places" in by_name["customer_support_desk"]["permissions"]
    assert "PATCH:/admins/promo-codes/{id}" in by_name["promo_handler"]["permissions"]
    assert "GET:/admins/monitoring/overview" in by_name["monitoring_analyst"]["permissions"]
    assert "POST:/admins/monitoring/audit/export" in by_name["audit_compliance_reviewer"]["permissions"]
    assert "GET:/admins/reports/users/summary" in by_name["reports_viewer"]["permissions"]


@pytest.mark.asyncio
async def test_permissions_from_group_names_resolves_specialized_group(monkeypatch: pytest.MonkeyPatch) -> None:
    keys = [
        "GET:/admins/promo-codes",
        "GET:/admins/promo-codes/{id}",
        "POST:/admins/promo-codes",
        "PATCH:/admins/promo-codes/{id}",
        "DELETE:/admins/promo-codes/{id}",
    ]
    monkeypatch.setattr(admin_service, "default_permissions", lambda: _permission_list(keys))

    class _FakeGroupsRepo:
        async def find_one(self, _query):
            return None

    monkeypatch.setattr(admin_service, "db", SimpleNamespace(admin_permission_groups=_FakeGroupsRepo()))

    resolved = await admin_service._permissions_from_group_names(["promo_handler"])
    assert resolved == keys


@pytest.mark.asyncio
async def test_create_permission_group_rejects_built_in_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_service, "default_permissions", lambda: _permission_list(["GET:/admins/profile"]))

    with pytest.raises(HTTPException) as exc:
        await admin_service.create_permission_group(
            created_by="admin-1",
            name="promo_handler",
            description="custom attempt",
            permissions=["GET:/admins/profile"],
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == "Permission group name already exists"
