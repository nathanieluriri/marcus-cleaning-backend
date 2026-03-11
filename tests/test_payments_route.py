from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import payments_route
from schemas.payment_schema import PaymentMethodOut, PaymentTransactionOut
from security.auth import verify_any_token
from security.principal import AuthPrincipal


def _principal(*, role: str = "customer", user_id: str = "customer-1") -> AuthPrincipal:
    return AuthPrincipal(
        user_id=user_id,
        role=role,  # type: ignore[arg-type]
        access_token_id="access-1",
        jwt_token="jwt-1",
    )


def _build_app(*, principal: AuthPrincipal) -> FastAPI:
    app = FastAPI()
    app.include_router(payments_route.router, prefix="/v1")
    app.dependency_overrides[verify_any_token] = lambda: principal
    return app


def _payment_transaction(*, owner_id: str) -> PaymentTransactionOut:
    return PaymentTransactionOut(
        _id="payment-1",
        owner_id=owner_id,
        booking_id="booking-1",
        provider="test",
        reference="ref-1",
        status="pending",
        amount_minor=11_500,
        currency="NGN",
        response_payload={"checkout_url": "https://example.com/checkout"},
        idempotency_key="test:ref-1",
        created_at=100,
        updated_at=100,
    )


def _payment_method(*, owner_id: str, method_id: str = "method-1", is_default: bool = False) -> PaymentMethodOut:
    return PaymentMethodOut(
        _id=method_id,
        owner_id=owner_id,
        provider="flutterwave",
        provider_method_ref="pm_ref_1",
        type="card",
        label="Personal Card",
        brand="visa",
        last4="1234",
        exp_month=12,
        exp_year=2030,
        bank_name=None,
        is_default=is_default,
        status="active",
        created_at=100,
        updated_at=100,
    )


def test_fetch_payment_by_reference_allows_owner(monkeypatch):
    async def _stub_get_tx(*, reference: str):
        assert reference == "ref-1"
        return _payment_transaction(owner_id="customer-1")

    monkeypatch.setattr(payments_route, "get_payment_transaction_by_reference_or_404", _stub_get_tx)
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.get("/v1/payments/reference/ref-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["reference"] == "ref-1"


def test_fetch_payment_by_reference_rejects_non_owner_non_admin(monkeypatch):
    async def _stub_get_tx(*, reference: str):
        assert reference == "ref-1"
        return _payment_transaction(owner_id="customer-2")

    monkeypatch.setattr(payments_route, "get_payment_transaction_by_reference_or_404", _stub_get_tx)
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.get("/v1/payments/reference/ref-1")

    assert response.status_code == 403
    payload = response.json()
    assert payload["detail"]["code"] == "AUTH_PERMISSION_DENIED"


def test_fetch_payment_by_reference_allows_admin(monkeypatch):
    async def _stub_get_tx(*, reference: str):
        assert reference == "ref-1"
        return _payment_transaction(owner_id="customer-2")

    monkeypatch.setattr(payments_route, "get_payment_transaction_by_reference_or_404", _stub_get_tx)
    client = TestClient(_build_app(principal=_principal(user_id="admin-1", role="admin")))

    response = client.get("/v1/payments/reference/ref-1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["owner_id"] == "customer-2"


def test_reconcile_payment_rejects_non_admin(monkeypatch):
    async def _stub_reconcile_payment_transaction(*, payment_id: str):
        raise AssertionError(f"Unexpected reconcile call for {payment_id}")

    monkeypatch.setattr(payments_route, "reconcile_payment_transaction", _stub_reconcile_payment_transaction)
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.post("/v1/payments/payment-1/reconcile")

    assert response.status_code == 403
    payload = response.json()
    assert payload["detail"]["code"] == "AUTH_PERMISSION_DENIED"


def test_reconcile_payment_allows_admin(monkeypatch):
    async def _stub_reconcile_payment_transaction(*, payment_id: str):
        assert payment_id == "payment-1"
        return _payment_transaction(owner_id="customer-2")

    monkeypatch.setattr(payments_route, "reconcile_payment_transaction", _stub_reconcile_payment_transaction)
    client = TestClient(_build_app(principal=_principal(user_id="admin-1", role="admin")))

    response = client.post("/v1/payments/payment-1/reconcile")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"].get("id") == "payment-1" or payload["data"].get("_id") == "payment-1"
    assert payload["data"]["reference"] == "ref-1"


def test_list_payment_methods_returns_owner_methods(monkeypatch):
    async def _stub_list_payment_methods_for_owner(*, owner_id: str, start: int = 0, stop: int = 100):
        assert owner_id == "customer-1"
        assert start == 0
        assert stop == 20
        return [_payment_method(owner_id=owner_id, is_default=True)]

    monkeypatch.setattr(payments_route, "list_payment_methods_for_owner", _stub_list_payment_methods_for_owner)
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.get("/v1/payments/methods")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"][0]["owner_id"] == "customer-1"
    assert payload["data"][0]["is_default"] is True


def test_create_payment_method_rejects_unknown_fields():
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.post(
        "/v1/payments/methods",
        json={
            "provider": "flutterwave",
            "provider_method_ref": "pm_ref_1",
            "type": "card",
            "label": "Primary Card",
            "pan": "4111111111111111",
        },
    )

    assert response.status_code == 422


def test_set_default_payment_method_calls_service(monkeypatch):
    async def _stub_set_default_payment_method_for_owner(*, owner_id: str, method_id: str):
        assert owner_id == "customer-1"
        assert method_id == "method-2"
        return _payment_method(owner_id=owner_id, method_id=method_id, is_default=True)

    monkeypatch.setattr(payments_route, "set_default_payment_method_for_owner", _stub_set_default_payment_method_for_owner)
    client = TestClient(_build_app(principal=_principal(user_id="customer-1", role="customer")))

    response = client.post("/v1/payments/methods/method-2/set-default")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["_id"] == "method-2"
    assert payload["data"]["is_default"] is True
