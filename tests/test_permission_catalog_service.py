from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends, FastAPI, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.errors import AppException, ErrorCode
from services.permission_catalog_service import build_permission_catalog_from_routes

bearer = HTTPBearer()


def _verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> str:
    return credentials.credentials


def _build_sample_app() -> FastAPI:
    app = FastAPI()

    admins_router = APIRouter(prefix="/admins")
    customers_router = APIRouter(prefix="/customers")
    cleaners_router = APIRouter(prefix="/cleaners")
    payments_router = APIRouter(prefix="/payments")

    @admins_router.get("/profile")
    def admin_profile():
        return {"ok": True}

    @customers_router.get("/me", summary="Customer profile", dependencies=[Depends(_verify_token)])
    def customer_me():
        return {"ok": True}

    @customers_router.post("/signup")
    def customer_signup():
        return {"ok": True}

    @cleaners_router.delete("/account", dependencies=[Depends(_verify_token)])
    def cleaner_delete():
        return {"deleted": True}

    @payments_router.get("/{payment_id}", dependencies=[Depends(_verify_token)])
    def payment_get(payment_id: str):
        return {"id": payment_id}

    app.include_router(admins_router, prefix="/v1")
    app.include_router(customers_router, prefix="/v1")
    app.include_router(cleaners_router, prefix="/v1")
    app.include_router(payments_router, prefix="/v1")
    return app


def test_permission_catalog_returns_grouped_and_flat_for_non_admin_v1_routes():
    app = _build_sample_app()
    catalog = build_permission_catalog_from_routes(app.routes)

    grouped_resources = [group.resource for group in catalog.grouped]
    assert grouped_resources == ["cleaners", "customers", "payments"]

    keys = [permission.key for permission in catalog.flat.permissions]
    assert "GET:/customers/me" in keys
    assert "POST:/customers/signup" in keys
    assert "DELETE:/cleaners/account" in keys
    assert "GET:/payments/{payment_id}" in keys
    assert "GET:/admins/profile" not in keys

    paths = [permission.path for permission in catalog.flat.permissions]
    assert "/customers/me" in paths
    assert "/payments/{payment_id}" in paths
    assert all(not path.startswith("/v1/") for path in paths)

    route_items = [item for group in catalog.grouped for item in group.routes]
    auth_map = {item.key: item.requires_auth for item in route_items}
    assert auth_map["GET:/customers/me"] is True
    assert auth_map["POST:/customers/signup"] is False


def test_permission_catalog_raises_for_duplicate_permission_keys():
    app = FastAPI()
    customers_router_v1 = APIRouter(prefix="/customers")
    customers_router_v2 = APIRouter(prefix="/customers")

    @customers_router_v1.get("/me", status_code=status.HTTP_200_OK)
    def customer_me_one():
        return {"ok": True}

    @customers_router_v2.get("/me", status_code=status.HTTP_200_OK)
    def customer_me_two():
        return {"ok": True}

    app.include_router(customers_router_v1, prefix="/v1")
    app.include_router(customers_router_v2, prefix="/v1")

    with pytest.raises(AppException) as exc_info:
        build_permission_catalog_from_routes(app.routes)

    exc = exc_info.value
    assert getattr(exc, "status_code", None) == 500
    assert exc.detail["code"] == ErrorCode.INTERNAL_ERROR.value
