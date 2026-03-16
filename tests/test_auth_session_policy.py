from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from security import auth


def test_enforce_session_policy_rejects_max_age_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_settings = SimpleNamespace(
        auth_session_max_age_admin_seconds=60,
        auth_session_max_age_cleaner_seconds=60,
        auth_session_max_age_customer_seconds=60,
        auth_session_idle_timeout_admin_seconds=120,
        auth_session_idle_timeout_cleaner_seconds=120,
        auth_session_idle_timeout_customer_seconds=120,
    )
    monkeypatch.setattr(auth, "_SETTINGS", fake_settings)

    now = int(time.time())
    claims = SimpleNamespace(iat=now - 300)
    account = SimpleNamespace(last_auth_at=now)

    with pytest.raises(Exception):
        auth._enforce_session_policy(role="admin", claims=claims, account=account)


def test_enforce_session_policy_rejects_idle_timeout_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_settings = SimpleNamespace(
        auth_session_max_age_admin_seconds=600,
        auth_session_max_age_cleaner_seconds=600,
        auth_session_max_age_customer_seconds=600,
        auth_session_idle_timeout_admin_seconds=30,
        auth_session_idle_timeout_cleaner_seconds=30,
        auth_session_idle_timeout_customer_seconds=30,
    )
    monkeypatch.setattr(auth, "_SETTINGS", fake_settings)

    now = int(time.time())
    claims = SimpleNamespace(iat=now)
    account = SimpleNamespace(last_auth_at=now - 120)

    with pytest.raises(Exception):
        auth._enforce_session_policy(role="admin", claims=claims, account=account)
