from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from api.web import payment_template_route as payment_template_module
from api.web.payment_template_route import build_test_payment_preview, router as web_payment_template_router


def _build_test_app() -> FastAPI:
    app = FastAPI()
    base_dir = Path(__file__).resolve().parents[1]
    app.mount("/static", StaticFiles(directory=str(base_dir / "static")), name="static")
    app.include_router(web_payment_template_router)
    return app


def test_build_test_payment_preview_has_expected_shape():
    preview = build_test_payment_preview()
    assert preview["provider"] == "STRIPE"
    assert preview["currency"] == "USD"
    assert preview["amount_minor"] > 0
    assert preview["formatted_amount"] == "1,299.00"


def test_payment_template_page_renders():
    client = TestClient(_build_test_app())
    response = client.get("/web/payments/template")

    assert response.status_code == 200
    assert "Payment details" in response.text
    assert "Pay USD 1,299.00" in response.text
    assert "MRC-TEMPLATE-2026-00231" in response.text


def test_payment_template_assets_are_served():
    client = TestClient(_build_test_app())

    css_response = client.get("/static/payment-template.css")
    js_response = client.get("/static/payment-template.js")

    assert css_response.status_code == 200
    assert "checkout-card" in css_response.text
    assert js_response.status_code == 200
    assert "is-success" in js_response.text


def test_payment_link_page_renders_from_stored_intent(monkeypatch):
    async def _stub_get_intent(reference: str):
        assert reference == "ref-123"
        return {
            "reference": "ref-123",
            "provider": "test",
            "currency": "usd",
            "amount_minor": 5000,
            "metadata": {
                "title": "Move-out deep clean",
                "description": "Includes oven, refrigerator, and windows.",
                "billing_period": "One-time payment",
                "service_date": "March 3, 2026",
            },
        }

    monkeypatch.setattr(payment_template_module, "_get_test_payment_intent", _stub_get_intent)
    client = TestClient(_build_test_app())
    response = client.get("/web/payments/link/ref-123")

    assert response.status_code == 200
    assert "Move-out deep clean" in response.text
    assert "USD 50.00" in response.text
    assert "ref-123" in response.text


def test_payment_link_page_returns_404_for_missing_reference(monkeypatch):
    async def _stub_get_intent(reference: str):
        return None

    monkeypatch.setattr(payment_template_module, "_get_test_payment_intent", _stub_get_intent)
    client = TestClient(_build_test_app())
    response = client.get("/web/payments/link/missing-ref")

    assert response.status_code == 404
    assert "TestPaymentIntent not found" in response.text
