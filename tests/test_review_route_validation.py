from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.v1 import review as review_route


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(review_route.router, prefix="/v1")
    return app


def test_create_review_rejects_short_comment(monkeypatch):
    async def _stub_access():
        return review_route.ReviewAccessContext(
            customer_id="customer-1",
            booking_id="booking-1",
            cleaner_id="cleaner-1",
        )

    monkeypatch.setattr(review_route, "add_review", lambda _payload: None)
    app = _build_app()
    app.dependency_overrides[review_route.require_review_create_access] = _stub_access
    client = TestClient(app)

    response = client.post(
        "/v1/reviews/",
        json={
            "booking_id": "booking-1",
            "comment": "too short",
            "stars": 5,
        },
    )

    assert response.status_code == 422


def test_create_review_allows_minimum_length_comment(monkeypatch):
    async def _stub_access():
        return review_route.ReviewAccessContext(
            customer_id="customer-1",
            booking_id="booking-1",
            cleaner_id="cleaner-1",
        )

    async def _stub_add_review(payload):
        return {
            "_id": "review-1",
            "customer_id": payload.customer_id,
            "booking_id": payload.booking_id,
            "cleaner_id": payload.cleaner_id,
            "comment": payload.comment,
            "stars": payload.stars,
            "date_created": 100,
            "last_updated": 100,
        }

    monkeypatch.setattr(review_route, "add_review", _stub_add_review)
    app = _build_app()
    app.dependency_overrides[review_route.require_review_create_access] = _stub_access
    client = TestClient(app)

    response = client.post(
        "/v1/reviews/",
        json={
            "booking_id": "booking-1",
            "comment": "great work!",
            "stars": 5,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["comment"] == "great work!"


def test_update_review_rejects_short_comment(monkeypatch):
    async def _stub_access():
        return review_route.ReviewAccessContext(
            customer_id="customer-1",
            booking_id="booking-1",
            cleaner_id="cleaner-1",
            review_id="review-1",
        )

    monkeypatch.setattr(review_route, "update_review_by_id", lambda **_kwargs: None)
    app = _build_app()
    app.dependency_overrides[review_route.require_review_update_access] = _stub_access
    client = TestClient(app)

    response = client.patch(
        "/v1/reviews/review-1",
        json={
            "comment": "short",
        },
    )

    assert response.status_code == 422


def test_update_review_allows_valid_comment(monkeypatch):
    async def _stub_access():
        return review_route.ReviewAccessContext(
            customer_id="customer-1",
            booking_id="booking-1",
            cleaner_id="cleaner-1",
            review_id="review-1",
        )

    async def _stub_update_review_by_id(*, id: str, data):
        return {
            "_id": id,
            "customer_id": "customer-1",
            "booking_id": "booking-1",
            "cleaner_id": "cleaner-1",
            "comment": data.comment or "great work!",
            "stars": 4,
            "date_created": 100,
            "last_updated": data.last_updated,
        }

    monkeypatch.setattr(review_route, "update_review_by_id", _stub_update_review_by_id)
    app = _build_app()
    app.dependency_overrides[review_route.require_review_update_access] = _stub_access
    client = TestClient(app)

    response = client.patch(
        "/v1/reviews/review-1",
        json={
            "comment": "very detailed feedback",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["data"]["comment"] == "very detailed feedback"
