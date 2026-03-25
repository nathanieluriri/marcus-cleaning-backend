from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import admin_route, cleaner_route, customer_route
from security.account_status_check import check_admin_account_status_and_permissions
from security.auth import verify_cleaner_token
from security.booking_access_check import require_customer_principal
from security.principal import AuthPrincipal


def _customer_principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="67f0f0f0f0f0f0f0f0f0f001",
        role="customer",
        access_token_id="acc-1",
        jwt_token="jwt-1",
    )


def _cleaner_principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="67f0f0f0f0f0f0f0f0f0f002",
        role="cleaner",
        access_token_id="acc-2",
        jwt_token="jwt-2",
    )


def test_customer_language_routes(monkeypatch):
    app = FastAPI()
    app.include_router(customer_route.router, prefix="/v1")
    app.dependency_overrides[require_customer_principal] = _customer_principal

    async def _stub_retrieve_customer(*, id: str):
        assert id == "67f0f0f0f0f0f0f0f0f0f001"
        return SimpleNamespace(preferredLanguage="fr")

    async def _stub_update_customer(*, user_id: str, user_data):
        assert user_id == "67f0f0f0f0f0f0f0f0f0f001"
        assert user_data.preferredLanguage == "en"
        return SimpleNamespace(preferredLanguage="en")

    monkeypatch.setattr(customer_route, "retrieve_user_by_user_id", _stub_retrieve_customer)
    monkeypatch.setattr(customer_route, "update_user_by_id", _stub_update_customer)

    client = TestClient(app)
    get_response = client.get("/v1/customers/me/language", headers={"Accept-Language": "fr-FR"})
    patch_response = client.patch("/v1/customers/me/language", json={"language": "en"})

    assert get_response.status_code == 200
    assert get_response.json()["data"]["language"] == "fr"
    assert get_response.headers["content-language"] == "fr"
    assert patch_response.status_code == 200
    assert patch_response.json()["data"]["language"] == "en"


def test_customer_login_returns_language_from_profile(monkeypatch):
    app = FastAPI()
    app.include_router(customer_route.router, prefix="/v1")

    class _CustomerAuthPayload:
        preferredLanguage = "fr"

        def model_dump(self, mode: str = "json", by_alias: bool = True):
            _ = mode, by_alias
            return {
                "_id": "67f0f0f0f0f0f0f0f0f0f001",
                "email": "customer@example.com",
                "firstName": "Test",
                "lastName": "User",
                "access_token": "access-token",
                "refresh_token": "refresh-token",
            }

    async def _stub_authenticate_user(user_data):
        _ = user_data
        return _CustomerAuthPayload()

    monkeypatch.setattr(customer_route, "authenticate_user", _stub_authenticate_user)

    client = TestClient(app)
    response = client.post(
        "/v1/customers/login",
        json={"email": "customer@example.com", "password": "password123"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["language"] == "fr"
    assert response.headers["content-language"] == "fr"


def test_cleaner_language_routes(monkeypatch):
    app = FastAPI()
    app.include_router(cleaner_route.router, prefix="/v1")
    app.dependency_overrides[verify_cleaner_token] = _cleaner_principal

    async def _stub_retrieve_cleaner(*, id: str):
        assert id == "67f0f0f0f0f0f0f0f0f0f002"
        return SimpleNamespace(preferredLanguage="fr")

    async def _stub_update_cleaner(*, user_id: str, user_data):
        assert user_id == "67f0f0f0f0f0f0f0f0f0f002"
        assert user_data.preferredLanguage == "fr"
        return SimpleNamespace(preferredLanguage="fr")

    monkeypatch.setattr(cleaner_route, "retrieve_user_by_user_id", _stub_retrieve_cleaner)
    monkeypatch.setattr(cleaner_route, "update_user_by_id", _stub_update_cleaner)

    client = TestClient(app)
    get_response = client.get("/v1/cleaners/me/language")
    patch_response = client.patch("/v1/cleaners/me/language", json={"language": "fr"})

    assert get_response.status_code == 200
    assert get_response.json()["data"]["language"] == "fr"
    assert patch_response.status_code == 200
    assert patch_response.json()["data"]["language"] == "fr"


def test_admin_language_routes(monkeypatch):
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")
    app.dependency_overrides[check_admin_account_status_and_permissions] = (
        lambda: SimpleNamespace(id="67f0f0f0f0f0f0f0f0f0f003", preferredLanguage="en", email="admin@example.com")
    )

    async def _stub_update_admin(*, admin_id: str, admin_data, is_password_getting_changed: bool = False):
        _ = is_password_getting_changed
        assert admin_id == "67f0f0f0f0f0f0f0f0f0f003"
        assert admin_data.preferredLanguage == "fr"
        return SimpleNamespace(preferredLanguage="fr")

    monkeypatch.setattr(admin_route, "update_admin_by_id", _stub_update_admin)

    client = TestClient(app)
    get_response = client.get("/v1/admins/profile/language")
    patch_response = client.patch("/v1/admins/profile/language", json={"language": "fr"})

    assert get_response.status_code == 200
    assert get_response.json()["data"]["language"] == "en"
    assert patch_response.status_code == 200
    assert patch_response.json()["data"]["language"] == "fr"
