from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api.v1 import admin_route
from security.account_status_check import check_admin_account_status_and_permissions


def _build_app(*, override_exception: HTTPException | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(admin_route.router, prefix="/v1")
    if override_exception is None:
        app.dependency_overrides[check_admin_account_status_and_permissions] = (
            lambda: SimpleNamespace(id="admin-1", email="admin@example.com")
        )
    else:
        async def _raise_override():
            raise override_exception

        app.dependency_overrides[check_admin_account_status_and_permissions] = _raise_override
    return app


def test_admin_onboarding_queue_route_success(monkeypatch):
    async def _stub_retrieve_admin_onboarding_queue(*, start: int, stop: int, sort: str, search: str | None):
        assert start == 0
        assert stop == 20
        assert sort == "submitted_at"
        assert search == "john"
        return [
            {
                "id": "67f0f0f0f0f0f0f0f0f0f0f2",
                "_id": "67f0f0f0f0f0f0f0f0f0f0f2",
                "fullName": "John Cleaner",
                "email": "john@example.com",
                "onboarding_status": "PENDING",
                "profileCompleteness": 100,
                "missingRequirements": [],
                "submittedAt": 1,
                "slaAgeHours": 2,
            }
        ]

    monkeypatch.setattr(admin_route, "retrieve_admin_onboarding_queue", _stub_retrieve_admin_onboarding_queue)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/onboarding/queue?start=0&stop=20&sort=submitted_at&search=john")
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"][0]["id"] == payload["data"][0]["_id"]


def test_admin_monitoring_audit_list_route_success(monkeypatch):
    async def _stub_list_monitoring_audit(**kwargs):
        assert kwargs["start"] == 0
        assert kwargs["stop"] == 10
        assert len(kwargs["event_types"]) == 1
        assert kwargs["event_types"][0].value == "admin_login_failed"
        return {
            "items": [],
            "pagination": {"start": 0, "stop": 10, "count": 0, "total": 0, "next_cursor": None, "has_more": False},
            "query": {},
        }

    monkeypatch.setattr(admin_route, "list_monitoring_audit", _stub_list_monitoring_audit)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/monitoring/audit/history?start=0&stop=10&event_type=admin_login_failed")
    assert response.status_code == 200
    assert response.json()["data"]["pagination"]["total"] == 0


def test_admin_monitoring_audit_detail_route_not_found(monkeypatch):
    async def _stub_get_monitoring_audit_event(
        *,
        event_id: str,
        include_payload: bool = True,
        include_related: bool = True,
        redaction=None,
        allow_unredacted: bool = False,
    ):
        _ = event_id
        _ = include_payload, include_related, redaction, allow_unredacted
        raise HTTPException(status_code=404, detail="Monitoring audit event not found")

    monkeypatch.setattr(admin_route, "get_monitoring_audit_event", _stub_get_monitoring_audit_event)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/monitoring/audit/history/67f0f0f0f0f0f0f0f0f0f0f2")
    assert response.status_code == 404


def test_admin_monitoring_audit_list_route_accepts_csv_event_type_and_stop_zero(monkeypatch):
    async def _stub_list_monitoring_audit(**kwargs):
        assert kwargs["start"] == 0
        assert kwargs["stop"] == 20
        values = [item.value for item in kwargs["event_types"]]
        assert values == ["admin_login_failed", "admin_login_succeeded"]
        return {
            "items": [],
            "pagination": {"start": 0, "stop": 20, "count": 0, "total": 0, "next_cursor": None, "has_more": False},
            "query": {},
        }

    monkeypatch.setattr(admin_route, "list_monitoring_audit", _stub_list_monitoring_audit)
    client = TestClient(_build_app())
    response = client.get(
        "/v1/admins/monitoring/audit/history?start=0&stop=0&event_type=admin_login_failed,admin_login_succeeded"
    )
    assert response.status_code == 200


def test_admin_reports_summary_and_signup_trend_routes(monkeypatch):
    async def _stub_get_admin_user_growth_summary(*, from_epoch: int | None, to_epoch: int | None):
        assert from_epoch == 1
        assert to_epoch == 100
        return {
            "total_customers": 10,
            "total_cleaners": 4,
            "new_customers_period": 3,
            "new_cleaners_period": 1,
            "pending_cleaner_onboarding": 2,
            "approved_cleaner_onboarding": 1,
            "rejected_cleaner_onboarding": 1,
            "from_epoch": 1,
            "to_epoch": 100,
        }

    async def _stub_get_admin_user_signup_trend(*, from_epoch: int | None, to_epoch: int | None, bucket):
        assert bucket == "day"
        return {"bucket": "day", "from_epoch": 1, "to_epoch": 100, "points": []}

    monkeypatch.setattr(admin_route, "get_admin_user_growth_summary", _stub_get_admin_user_growth_summary)
    monkeypatch.setattr(admin_route, "get_admin_user_signup_trend", _stub_get_admin_user_signup_trend)
    client = TestClient(_build_app())

    summary_response = client.get("/v1/admins/reports/users/summary?from_epoch=1&to_epoch=100")
    trend_response = client.get("/v1/admins/reports/users/signups-trend?from_epoch=1&to_epoch=100&bucket=day")
    assert summary_response.status_code == 200
    assert summary_response.json()["data"]["total_customers"] == 10
    assert trend_response.status_code == 200
    assert trend_response.json()["data"]["bucket"] == "day"


def test_admin_role_permission_preview_and_rollout_impact_routes(monkeypatch):
    async def _stub_preview_role_permission_template_for_role(*, role: str, permission_list):
        assert role == "customer"
        assert permission_list.permissions
        return {"additions": ["GET:/customers/me"], "removals": [], "invalidEntries": [], "duplicateKeys": []}

    async def _stub_get_role_permission_rollout_impact(*, role: str):
        assert role == "customer"
        return {"role": role, "source": "template", "matched_count": 10, "would_change_count": 5}

    monkeypatch.setattr(admin_route, "preview_role_permission_template_for_role", _stub_preview_role_permission_template_for_role)
    monkeypatch.setattr(admin_route, "get_role_permission_rollout_impact", _stub_get_role_permission_rollout_impact)
    client = TestClient(_build_app())

    preview_response = client.post(
        "/v1/admins/permission-templates/customer/preview",
        json={"permissionList": {"permissions": [{"name": "customer_profile_read", "methods": ["GET"], "path": "/customers/me"}]}},
    )
    impact_response = client.get("/v1/admins/permission-templates/customer/rollout-impact")

    assert preview_response.status_code == 200
    assert impact_response.status_code == 200
    assert impact_response.json()["data"]["would_change_count"] == 5


def test_admin_customer_detail_route_success(monkeypatch):
    async def _stub_retrieve_admin_customer_detail(*, customer_id: str):
        assert customer_id == "67f0f0f0f0f0f0f0f0f0f0f1"
        return {
            "id": customer_id,
            "_id": customer_id,
            "firstName": "Jane",
            "lastName": "Doe",
            "email": "jane@example.com",
            "phoneNumber": None,
            "accountStatus": "ACTIVE",
            "date_created": 1,
            "last_updated": 2,
            "avatarDocumentId": None,
            "permissionList": None,
        }

    monkeypatch.setattr(admin_route, "retrieve_admin_customer_detail", _stub_retrieve_admin_customer_detail)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/customers/67f0f0f0f0f0f0f0f0f0f0f1")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == response.json()["data"]["_id"]


def test_admin_customer_places_route_success(monkeypatch):
    async def _stub_retrieve_admin_customer_places(*, admin_id: str, customer_id: str, start: int, stop: int):
        assert admin_id == "admin-1"
        assert customer_id == "67f0f0f0f0f0f0f0f0f0f0f1"
        assert start == 0
        assert stop == 20
        return [
            {
                "place_id": "place_1",
                "name": "Ikeja Home",
                "formatted_address": "Ikeja, Lagos",
                "longitude": 3.349,
                "latitude": 6.601,
                "country_code": "NG",
                "description": "Saved default address",
            }
        ]

    monkeypatch.setattr(admin_route, "retrieve_admin_customer_places", _stub_retrieve_admin_customer_places)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/customers/67f0f0f0f0f0f0f0f0f0f0f1/places?start=0&stop=20")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["place_id"] == "place_1"


def test_admin_customer_places_create_route_success(monkeypatch):
    async def _stub_create_admin_customer_place(*, admin_id: str, customer_id: str, payload):
        assert admin_id == "admin-1"
        assert customer_id == "67f0f0f0f0f0f0f0f0f0f0f1"
        assert payload.label == "Home"
        assert payload.place_id == "pid-1"
        assert payload.isDefault is True
        return {
            "id": "addr-1",
            "user_id": customer_id,
            "label": "Home",
            "place": {
                "place_id": "pid-1",
                "name": "Lekki",
                "formatted_address": "Lekki, Lagos",
                "longitude": 3.52,
                "latitude": 6.44,
                "country_code": "NG",
                "description": "Lekki, Lagos",
            },
            "isDefault": True,
            "dateCreated": 100,
            "lastUpdated": 100,
        }

    monkeypatch.setattr(admin_route, "create_admin_customer_place", _stub_create_admin_customer_place)
    client = TestClient(_build_app())
    response = client.post(
        "/v1/admins/customers/67f0f0f0f0f0f0f0f0f0f0f1/places",
        json={"label": "Home", "place_id": "pid-1", "isDefault": True},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["label"] == "Home"
    assert payload["data"]["place"]["place_id"] == "pid-1"


def test_admin_user_autocomplete_route_success(monkeypatch):
    async def _stub_retrieve_admin_user_autocomplete(*, query: str, limit: int):
        assert query == "john"
        assert limit == 8
        return {
            "query": "john",
            "customers": [
                {
                    "id": "67f0f0f0f0f0f0f0f0f0f0f1",
                    "_id": "67f0f0f0f0f0f0f0f0f0f0f1",
                    "role": "customer",
                    "firstName": "John",
                    "lastName": "Doe",
                    "email": "john@example.com",
                    "onboarding_status": None,
                    "allow_admin_selection": None,
                }
            ],
            "cleaners": [
                {
                    "id": "67f0f0f0f0f0f0f0f0f0f0f2",
                    "_id": "67f0f0f0f0f0f0f0f0f0f0f2",
                    "role": "cleaner",
                    "firstName": "Jane",
                    "lastName": "Cleaner",
                    "email": "jane@example.com",
                    "onboarding_status": "APPROVED",
                    "allow_admin_selection": True,
                }
            ],
        }

    monkeypatch.setattr(admin_route, "retrieve_admin_user_autocomplete", _stub_retrieve_admin_user_autocomplete)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/users/autocomplete?q=john&limit=8")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["customers"][0]["email"] == "john@example.com"
    assert payload["data"]["cleaners"][0]["allow_admin_selection"] is True


def test_admin_elevation_request_status_route_returns_latest(monkeypatch):
    async def _stub_get_latest_admin_elevation_request_status(*, admin_id: str):
        assert admin_id == "admin-1"
        return {
            "requestId": "req-1",
            "status": "PENDING",
            "requestedPermissions": ["GET:/admins/service-definitions"],
            "reason": "Need extra access",
            "decisionNote": None,
            "dateCreated": 123,
            "lastUpdated": 456,
        }

    monkeypatch.setattr(admin_route, "get_latest_admin_elevation_request_status", _stub_get_latest_admin_elevation_request_status)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/access/request-elevation/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["status"] == "PENDING"
    assert payload["data"]["requestId"] == "req-1"


def test_admin_elevation_request_status_route_returns_none_state(monkeypatch):
    async def _stub_get_latest_admin_elevation_request_status(*, admin_id: str):
        assert admin_id == "admin-1"
        return {
            "requestId": None,
            "status": "NONE",
            "requestedPermissions": [],
            "reason": None,
            "decisionNote": None,
            "dateCreated": None,
            "lastUpdated": None,
        }

    monkeypatch.setattr(admin_route, "get_latest_admin_elevation_request_status", _stub_get_latest_admin_elevation_request_status)
    client = TestClient(_build_app())
    response = client.get("/v1/admins/access/request-elevation/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["status"] == "NONE"


def test_delete_admin_by_id_requires_main_super_admin(monkeypatch):
    async def _stub_remove_admin_with_auth0(*, admin_id: str):
        _ = admin_id
        return {"deleted": True, "adminId": admin_id, "auth0Status": "deleted"}

    monkeypatch.setattr(admin_route, "remove_admin_with_auth0", _stub_remove_admin_with_auth0)
    monkeypatch.setattr(admin_route, "is_main_super_admin_actor", lambda **_kwargs: False)

    client = TestClient(_build_app())
    response = client.delete("/v1/admins/67f0f0f0f0f0f0f0f0f0f0f2")
    assert response.status_code == 403
    payload = response.json()
    assert payload["detail"]["code"] == "ADMIN_DELETE_FORBIDDEN"


def test_delete_admin_by_id_succeeds_for_main_super_admin(monkeypatch):
    async def _stub_remove_admin_with_auth0(*, admin_id: str):
        assert admin_id == "67f0f0f0f0f0f0f0f0f0f0f2"
        return {"deleted": True, "adminId": admin_id, "auth0Status": "deleted"}

    monkeypatch.setattr(admin_route, "remove_admin_with_auth0", _stub_remove_admin_with_auth0)
    monkeypatch.setattr(admin_route, "is_main_super_admin_actor", lambda **_kwargs: True)

    client = TestClient(_build_app())
    response = client.delete("/v1/admins/67f0f0f0f0f0f0f0f0f0f0f2")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["deleted"] is True
