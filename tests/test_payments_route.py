from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import payments_route
from schemas.payment_schema import PaymentTransactionOut
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
        id="payment-1",
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

