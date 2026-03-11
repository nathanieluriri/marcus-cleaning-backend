from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import customer_route
from security.booking_access_check import require_customer_principal
from security.principal import AuthPrincipal


def _principal() -> AuthPrincipal:
    return AuthPrincipal(
        user_id="customer-123",
        role="customer",
        access_token_id="access-123",
        jwt_token="jwt-123",
    )


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(customer_route.router, prefix="/v1")
    app.include_router(customer_route.customer_app_router, prefix="/v1")
    app.dependency_overrides[require_customer_principal] = _principal
    return app


def test_sign_in_contract_route_returns_enveloped_payload(monkeypatch):
    async def _stub_sign_in(payload):
        _ = payload
        return {
            "accessToken": "access-token",
            "refreshToken": "refresh-token",
            "expiresAt": datetime.now(timezone.utc).isoformat(),
            "user": {
                "id": "customer-123",
                "fullName": "Marcus Tester",
                "email": "tester@example.com",
                "phoneNumber": None,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            },
        }

    monkeypatch.setattr(customer_route, "sign_in_customer_contract", _stub_sign_in)

    client = TestClient(_build_app())
    response = client.post(
        "/v1/customers/sign-in",
        json={"email": "tester@example.com", "password": "password123"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["accessToken"] == "access-token"


def test_home_contract_route_returns_expected_structure(monkeypatch):
    async def _stub_home(principal):
        assert principal.user_id == "customer-123"
        return {
            "screen": "home",
            "user": {"firstName": "Marcus", "greetingEyebrow": "Welcome back"},
            "header": {"notification": {"unreadCount": 1, "enabled": True, "action": {"type": "route", "value": "/notifications", "label": None}}},
            "location": {"selected": {"id": "loc_1", "label": "Home", "addressLine": "123 Urban St", "hint": "Recently used"}, "locations": [], "action": {"type": "bottom_sheet", "value": "location_picker", "label": None}, "isLoading": False, "enabled": True},
            "sections": [],
            "nav": {"currentIndex": 0, "items": []},
        }

    monkeypatch.setattr(customer_route, "fetch_customer_home_page", _stub_home)

    client = TestClient(_build_app())
    response = client.get("/v1/home")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["screen"] == "home"


def test_fetch_cleaners_supports_filters(monkeypatch):
    async def _stub_cleaners(filters):
        assert filters.minRating == 4.5
        return [
            {
                "id": "cln_1",
                "name": "Sarah Jenkins",
                "rating": 4.9,
                "jobsDone": 240,
                "hourlyRate": 38.0,
                "isVerified": True,
                "avatarUrl": None,
                "roleLabel": "Professional Cleaner",
                "yearsExperience": 5,
                "bookingsCount": 1200,
                "heroImageUrl": None,
            }
        ]

    monkeypatch.setattr(customer_route, "list_contract_cleaners", _stub_cleaners)

    client = TestClient(_build_app())
    response = client.get("/v1/bookings/cleaners", params={"minRating": 4.5})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["id"] == "cln_1"


def test_fetch_cleaner_reviews_paginates(monkeypatch):
    async def _stub_reviews(cleaner_id, filters):
        assert cleaner_id == "cln_1"
        assert filters.pageSize == 10
        return {
            "items": [
                {
                    "id": "rv_1",
                    "reviewerName": "Marcus L.",
                    "rating": 5,
                    "text": "Great service",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "avatarUrl": None,
                }
            ],
            "nextCursor": "10",
        }

    monkeypatch.setattr(customer_route, "list_cleaner_reviews_contract", _stub_reviews)

    client = TestClient(_build_app())
    response = client.get("/v1/bookings/cleaners/cln_1/reviews", params={"pageSize": 10})

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["nextCursor"] == "10"


def test_create_booking_contract_returns_booking_id(monkeypatch):
    async def _stub_create(principal, payload):
        assert principal.user_id == "customer-123"
        _ = payload
        return {"bookingId": "BK-1700000000000"}

    monkeypatch.setattr(customer_route, "create_booking_contract", _stub_create)

    client = TestClient(_build_app())
    response = client.post(
        "/v1/bookings/create",
        json={
            "service": {"id": "svc_standard", "title": "Standard", "basePrice": 49.0},
            "duration": {"type": "preset", "hours": 2, "minutes": 0},
            "availableExtras": [{"id": "extra_laundry", "title": "Laundry", "price": 20.0, "isAvailable": True}],
            "selectedExtraIds": ["extra_laundry"],
            "location": {"id": "loc_home", "label": "Home", "address": "123 Urban St"},
            "schedule": {"date": "2026-03-10T12:00:00.000Z", "timeWindow": "10:00-10:30"},
            "cleaner": {
                "id": "cln_sarah",
                "name": "Sarah Jenkins",
                "rating": 4.9,
                "jobsDone": 240,
                "hourlyRate": 38.0,
                "isVerified": True,
                "avatarUrl": None,
                "roleLabel": "Professional Cleaner",
                "yearsExperience": 5,
                "bookingsCount": 1200,
                "heroImageUrl": None,
            },
            "pricing": {"base": 49.0, "extras": 20.0, "fees": 4.14, "total": 73.14, "currency": "USD"},
            "status": "draft",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["bookingId"] == "BK-1700000000000"


def test_fetch_notifications_contract(monkeypatch):
    async def _stub_notifications(page, page_size):
        assert page == 0
        assert page_size == 20
        return [
            {
                "id": "ntf_1",
                "type": "service_update",
                "title": "Cleaner is on the way",
                "message": "Arrives in 10 minutes",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "isRead": False,
                "action": {"type": "route", "value": "/booking/tracking/BK-123", "label": None},
            }
        ]

    monkeypatch.setattr(customer_route, "list_notifications_contract", _stub_notifications)

    client = TestClient(_build_app())
    response = client.get("/v1/notifications")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["id"] == "ntf_1"


def test_delete_notification_contract_returns_204(monkeypatch):
    async def _stub_delete(notification_id):
        assert notification_id == "ntf_1"

    monkeypatch.setattr(customer_route, "delete_notification_contract", _stub_delete)

    client = TestClient(_build_app())
    response = client.delete("/v1/notifications/ntf_1")

    assert response.status_code == 204


def test_fetch_settings_snapshot_contract(monkeypatch):
    async def _stub_fetch_settings_snapshot_contract(*, customer_id: str):
        assert customer_id == "customer-123"
        return {
            "notifications": {
                "enabled": True,
                "channels": {"push": True, "email": True, "sms": False},
                "quietHours": {
                    "enabled": True,
                    "startTime": "22:00",
                    "endTime": "07:00",
                    "timezone": "Africa/Lagos",
                },
            },
            "privacy": {},
            "security": {"biometricLoginEnabled": False, "twoFactorEnabled": False},
            "sessions": {},
            "legal": {},
        }

    monkeypatch.setattr(customer_route, "fetch_settings_snapshot_contract", _stub_fetch_settings_snapshot_contract)

    client = TestClient(_build_app())
    response = client.get("/v1/settings")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["notifications"]["quietHours"]["timezone"] == "Africa/Lagos"


def test_patch_notification_preferences_contract(monkeypatch):
    async def _stub_update_notification_preferences_contract(*, customer_id: str, payload):
        assert customer_id == "customer-123"
        assert payload.channels is not None
        assert payload.channels.push is False
        return {
            "enabled": True,
            "channels": {"push": False, "email": True, "sms": False},
            "quietHours": {
                "enabled": True,
                "startTime": "22:00",
                "endTime": "07:00",
                "timezone": "Africa/Lagos",
            },
        }

    monkeypatch.setattr(
        customer_route,
        "update_notification_preferences_contract",
        _stub_update_notification_preferences_contract,
    )

    client = TestClient(_build_app())
    response = client.patch(
        "/v1/settings/notifications",
        json={"channels": {"push": False}},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["channels"]["push"] is False


def test_patch_notification_preferences_rejects_invalid_timezone():
    client = TestClient(_build_app())
    response = client.patch(
        "/v1/settings/notifications",
        json={
            "quietHours": {
                "enabled": True,
                "startTime": "22:00",
                "endTime": "07:00",
                "timezone": "Not/A_Real_Zone",
            }
        },
    )
    assert response.status_code == 422


def test_patch_notification_preferences_rejects_invalid_time_format():
    client = TestClient(_build_app())
    response = client.patch(
        "/v1/settings/notifications",
        json={
            "quietHours": {
                "enabled": True,
                "startTime": "7pm",
                "endTime": "07:00",
                "timezone": "Africa/Lagos",
            }
        },
    )
    assert response.status_code == 422


def test_patch_security_preferences_contract(monkeypatch):
    async def _stub_update_security_preferences_contract(*, customer_id: str, payload):
        assert customer_id == "customer-123"
        assert payload.biometricLoginEnabled is True
        assert payload.twoFactorEnabled is False
        return {
            "biometricLoginEnabled": True,
            "twoFactorEnabled": False,
        }

    monkeypatch.setattr(
        customer_route,
        "update_security_preferences_contract",
        _stub_update_security_preferences_contract,
    )

    client = TestClient(_build_app())
    response = client.patch(
        "/v1/settings/security",
        json={"biometricLoginEnabled": True, "twoFactorEnabled": False},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["biometricLoginEnabled"] is True
    assert payload["data"]["twoFactorEnabled"] is False


def test_patch_security_preferences_rejects_invalid_boolean_payload():
    client = TestClient(_build_app())
    response = client.patch(
        "/v1/settings/security",
        json={"twoFactorEnabled": {"invalid": True}},
    )
    assert response.status_code == 422


def test_legacy_and_contract_auth_routes_coexist(monkeypatch):
    async def _stub_legacy_login(user_data):
        _ = user_data
        return {"access_token": "legacy-token"}

    async def _stub_contract_sign_in(payload):
        _ = payload
        return {
            "accessToken": "contract-token",
            "refreshToken": "refresh-token",
            "expiresAt": datetime.now(timezone.utc).isoformat(),
            "user": {
                "id": "customer-123",
                "fullName": "Marcus Tester",
                "email": "tester@example.com",
                "phoneNumber": None,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            },
        }

    monkeypatch.setattr(customer_route, "authenticate_user", _stub_legacy_login)
    monkeypatch.setattr(customer_route, "sign_in_customer_contract", _stub_contract_sign_in)

    client = TestClient(_build_app())

    legacy_response = client.post(
        "/v1/customers/login",
        json={"email": "tester@example.com", "password": "password123"},
    )
    contract_response = client.post(
        "/v1/customers/sign-in",
        json={"email": "tester@example.com", "password": "password123"},
    )

    assert legacy_response.status_code == 200
    assert contract_response.status_code == 200
    assert legacy_response.json()["data"]["access_token"] == "legacy-token"
    assert contract_response.json()["data"]["accessToken"] == "contract-token"


def test_update_customer_profile_route_calls_contract_service(monkeypatch):
    async def _stub_update_customer_profile_contract(*, customer_id: str, payload):
        assert customer_id == "customer-123"
        assert payload.fullName == "Marcus Dashi"
        assert payload.phoneNumber == "+2348012345678"
        assert payload.avatarDocumentId == "doc-1"
        return {
            "id": "customer-123",
            "fullName": "Marcus Dashi",
            "email": "tester@example.com",
            "phoneNumber": "+2348012345678",
            "avatarDocumentId": "doc-1",
            "avatarUrl": "https://cdn.example.com/avatar.jpg",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

    monkeypatch.setattr(
        customer_route,
        "update_customer_profile_contract",
        _stub_update_customer_profile_contract,
    )
    client = TestClient(_build_app())

    response = client.patch(
        "/v1/customers/me",
        json={
            "fullName": "Marcus Dashi",
            "phoneNumber": "+2348012345678",
            "avatarDocumentId": "doc-1",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["phoneNumber"] == "+2348012345678"
    assert payload["data"]["avatarDocumentId"] == "doc-1"


def test_update_customer_profile_route_rejects_invalid_phone():
    client = TestClient(_build_app())

    response = client.patch(
        "/v1/customers/me",
        json={
            "phoneNumber": "08012345678",
        },
    )

    assert response.status_code == 422


def test_saved_addresses_routes_call_service(monkeypatch):
    async def _stub_list_my_saved_addresses(*, user_id: str, start: int, stop: int):
        assert user_id == "customer-123"
        assert start == 0
        assert stop == 20
        return [
            {
                "id": "addr-1",
                "user_id": user_id,
                "label": "Home",
                "addressLine": "123 Urban St",
                "place": {
                    "place_id": "pid-1",
                    "name": "Lekki",
                    "formatted_address": "Lekki, Lagos",
                    "longitude": 3.52,
                    "latitude": 6.44,
                    "description": "Lekki, Lagos",
                },
                "isDefault": True,
                "dateCreated": 100,
                "lastUpdated": 100,
            }
        ]

    async def _stub_create_my_saved_address(*, user_id: str, payload):
        assert user_id == "customer-123"
        assert payload.label == "Home"
        return {
            "id": "addr-1",
            "user_id": user_id,
            "label": payload.label,
            "addressLine": payload.addressLine,
            "place": payload.place.model_dump(),
            "isDefault": True,
            "dateCreated": 100,
            "lastUpdated": 100,
        }

    async def _stub_update_my_saved_address(*, user_id: str, address_id: str, payload):
        assert user_id == "customer-123"
        assert address_id == "addr-1"
        assert payload.label == "Work"
        return {
            "id": address_id,
            "user_id": user_id,
            "label": "Work",
            "addressLine": "45 Marina",
            "place": {
                "place_id": "pid-2",
                "name": "Marina",
                "formatted_address": "Marina, Lagos",
                "longitude": 3.4,
                "latitude": 6.45,
                "description": "Marina, Lagos",
            },
            "isDefault": False,
            "dateCreated": 100,
            "lastUpdated": 200,
        }

    async def _stub_set_default_saved_address(*, user_id: str, address_id: str):
        assert user_id == "customer-123"
        assert address_id == "addr-1"
        return {
            "id": address_id,
            "user_id": user_id,
            "label": "Home",
            "addressLine": "123 Urban St",
            "place": {
                "place_id": "pid-1",
                "name": "Lekki",
                "formatted_address": "Lekki, Lagos",
                "longitude": 3.52,
                "latitude": 6.44,
                "description": "Lekki, Lagos",
            },
            "isDefault": True,
            "dateCreated": 100,
            "lastUpdated": 200,
        }

    async def _stub_delete_my_saved_address(*, user_id: str, address_id: str):
        assert user_id == "customer-123"
        assert address_id == "addr-1"
        return {"deleted": True}

    monkeypatch.setattr(customer_route, "list_my_saved_addresses", _stub_list_my_saved_addresses)
    monkeypatch.setattr(customer_route, "create_my_saved_address", _stub_create_my_saved_address)
    monkeypatch.setattr(customer_route, "update_my_saved_address", _stub_update_my_saved_address)
    monkeypatch.setattr(customer_route, "set_default_saved_address", _stub_set_default_saved_address)
    monkeypatch.setattr(customer_route, "delete_my_saved_address", _stub_delete_my_saved_address)

    client = TestClient(_build_app())

    list_response = client.get("/v1/customers/me/addresses")
    assert list_response.status_code == 200
    assert list_response.json()["success"] is True

    create_response = client.post(
        "/v1/customers/me/addresses",
        json={
            "label": "Home",
            "addressLine": "123 Urban St",
            "place": {
                "place_id": "pid-1",
                "name": "Lekki",
                "formatted_address": "Lekki, Lagos",
                "longitude": 3.52,
                "latitude": 6.44,
                "description": "Lekki, Lagos",
            },
            "isDefault": True,
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["success"] is True

    update_response = client.patch(
        "/v1/customers/me/addresses/addr-1",
        json={
            "label": "Work",
            "addressLine": "45 Marina",
            "place": {
                "place_id": "pid-2",
                "name": "Marina",
                "formatted_address": "Marina, Lagos",
                "longitude": 3.4,
                "latitude": 6.45,
                "description": "Marina, Lagos",
            },
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["success"] is True

    set_default_response = client.post("/v1/customers/me/addresses/addr-1/set-default")
    assert set_default_response.status_code == 200
    assert set_default_response.json()["success"] is True

    delete_response = client.delete("/v1/customers/me/addresses/addr-1")
    assert delete_response.status_code == 200
    assert delete_response.json()["success"] is True
