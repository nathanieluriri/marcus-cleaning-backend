from __future__ import annotations

import pytest

from core import settings as settings_module


def _set_minimal_valid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "SECRET_KEY": "secret",
        "SESSION_SECRET_KEY": "session-secret",
        "GOOGLE_MAPS_API_KEY": "maps-key",
        "GOOGLE_CLIENT_ID": "google-client-id",
        "GOOGLE_CLIENT_SECRET": "google-client-secret",
        "SUCCESS_PAGE_URL": "http://localhost:8080/success",
        "ERROR_PAGE_URL": "http://localhost:8080/error",
        "EMAIL_USERNAME": "mail@example.com",
        "EMAIL_PASSWORD": "mail-password",
        "EMAIL_HOST": "smtp.example.com",
        "EMAIL_PORT": "587",
        "CELERY_BROKER_URL": "redis://127.0.0.1:6379/0",
        "CELERY_RESULT_BACKEND": "redis://127.0.0.1:6379/0",
        "PAYMENT_DEFAULT_PROVIDER": "test",
        "TEST_PAYMENT_BASE_URL": "http://localhost:8000",
        "STORAGE_BACKEND": "local",
        "DB_TYPE": "mongodb",
        "MONGO_URL": "mongodb://localhost:27017",
        "DB_NAME": "marcus_cleaning",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_collect_missing_required_env_vars_includes_missing_base_and_provider_keys(
    monkeypatch: pytest.MonkeyPatch,
):
    _set_minimal_valid_env(monkeypatch)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("TEST_PAYMENT_BASE_URL", raising=False)

    missing = settings_module.collect_missing_required_env_vars()

    assert "SECRET_KEY" in missing
    assert "TEST_PAYMENT_BASE_URL" in missing


def test_collect_missing_required_env_vars_switches_by_payment_provider(
    monkeypatch: pytest.MonkeyPatch,
):
    _set_minimal_valid_env(monkeypatch)
    monkeypatch.setenv("PAYMENT_DEFAULT_PROVIDER", "stripe")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)

    missing = settings_module.collect_missing_required_env_vars()

    assert "STRIPE_WEBHOOK_SECRET" in missing
    assert "TEST_PAYMENT_BASE_URL" not in missing


def test_validate_required_environment_raises_with_missing_and_invalid_values(
    monkeypatch: pytest.MonkeyPatch,
):
    _set_minimal_valid_env(monkeypatch)
    monkeypatch.setenv("PAYMENT_DEFAULT_PROVIDER", "unknown")
    monkeypatch.setenv("EMAIL_PORT", "not-a-number")
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)

    with pytest.raises(RuntimeError) as exc_info:
        settings_module.validate_required_environment()

    message = str(exc_info.value)
    assert "Missing required environment variables" in message
    assert "- GOOGLE_MAPS_API_KEY" in message
    assert "Invalid environment values" in message
    assert "PAYMENT_DEFAULT_PROVIDER must be one of" in message
    assert "EMAIL_PORT must be a positive integer" in message

