from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Depends, FastAPI
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.testclient import TestClient

from api.v1.admin_route import router as admin_router
from security.account_status_check import check_admin_account_status_and_permissions

bearer = HTTPBearer()


def _verify_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
) -> str:
    return credentials.credentials


def _build_app_with_catalog_route() -> FastAPI:
    app = FastAPI()
    app.include_router(admin_router, prefix="/v1")

    customers_router = APIRouter(prefix="/customers")

    @customers_router.get("/me", dependencies=[Depends(_verify_token)])
    def customer_me():
        return {"ok": True}

    app.include_router(customers_router, prefix="/v1")

    app.dependency_overrides[check_admin_account_status_and_permissions] = lambda: SimpleNamespace(id="admin-1")
    return app


def test_admin_permission_catalog_route_returns_grouped_and_flat():
    client = TestClient(_build_app_with_catalog_route())
    response = client.get("/v1/admins/permissions/catalog")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["message"] == "Permission catalog fetched successfully"

    data = payload["data"]
    assert "grouped" in data
    assert "flat" in data

    keys = [item["key"] for item in data["flat"]["permissions"]]
    assert "GET:/customers/me" in keys
    assert all(not key.startswith("GET:/admins") for key in keys)

