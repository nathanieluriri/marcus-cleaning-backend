from __future__ import annotations

from types import SimpleNamespace

import pytest

from schemas.customer_app_contract import NotificationPreferencesPatchContract, SecurityPreferencesPatchContract
from services import customer_app_contract_service


class _FakeUserSettingsCollection:
    def __init__(self, row: dict | None):
        self._row = row
        self.last_update_args: tuple[dict, dict, bool] | None = None

    async def find_one(self, query: dict):
        if not self._row:
            return None
        if self._row.get("userId") != query.get("userId"):
            return None
        return self._row

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        self.last_update_args = (query, update, upsert)
        current_row = dict(self._row or {"userId": query.get("userId")})
        set_data = update.get("$set", {})
        for key, value in set_data.items():
            current_row[key] = value
        if "dateCreated" not in current_row:
            current_row["dateCreated"] = update.get("$setOnInsert", {}).get("dateCreated")
        self._row = current_row
        return SimpleNamespace(modified_count=1)


@pytest.mark.asyncio
async def test_fetch_settings_snapshot_contract_returns_defaults(monkeypatch: pytest.MonkeyPatch):
    fake_collection = _FakeUserSettingsCollection(row=None)
    monkeypatch.setattr(
        customer_app_contract_service,
        "db",
        SimpleNamespace(user_settings=fake_collection),
    )

    result = await customer_app_contract_service.fetch_settings_snapshot_contract(customer_id="customer-123")

    assert result.notifications.enabled is True
    assert result.notifications.channels.push is True
    assert result.notifications.channels.email is True
    assert result.notifications.channels.sms is False
    assert result.notifications.quietHours.enabled is False
    assert result.notifications.quietHours.startTime == "22:00"
    assert result.notifications.quietHours.endTime == "07:00"
    assert result.notifications.quietHours.timezone == "UTC"
    assert result.security.biometricLoginEnabled is False
    assert result.security.twoFactorEnabled is False


@pytest.mark.asyncio
async def test_update_notification_preferences_contract_merges_partial(monkeypatch: pytest.MonkeyPatch):
    fake_collection = _FakeUserSettingsCollection(
        row={
            "userId": "customer-123",
            "notifications": {
                "enabled": True,
                "channels": {"push": True, "email": True, "sms": False},
                "quietHours": {
                    "enabled": False,
                    "startTime": "22:00",
                    "endTime": "07:00",
                    "timezone": "UTC",
                },
            },
            "privacy": {},
            "security": {"biometricLoginEnabled": False, "twoFactorEnabled": False},
            "sessions": {},
            "legal": {},
        }
    )
    monkeypatch.setattr(
        customer_app_contract_service,
        "db",
        SimpleNamespace(user_settings=fake_collection),
    )

    result = await customer_app_contract_service.update_notification_preferences_contract(
        customer_id="customer-123",
        payload=NotificationPreferencesPatchContract(
            channels={"push": False},
            quietHours={"enabled": True, "timezone": "Africa/Lagos"},
        ),
    )

    assert result.enabled is True
    assert result.channels.push is False
    assert result.channels.email is True
    assert result.quietHours.enabled is True
    assert result.quietHours.startTime == "22:00"
    assert result.quietHours.endTime == "07:00"
    assert result.quietHours.timezone == "Africa/Lagos"
    assert fake_collection.last_update_args is not None
    query, _, upsert = fake_collection.last_update_args
    assert query == {"userId": "customer-123"}
    assert upsert is True


@pytest.mark.asyncio
async def test_update_security_preferences_contract_merges_partial(monkeypatch: pytest.MonkeyPatch):
    fake_collection = _FakeUserSettingsCollection(
        row={
            "userId": "customer-123",
            "notifications": {
                "enabled": True,
                "channels": {"push": True, "email": True, "sms": False},
                "quietHours": {
                    "enabled": False,
                    "startTime": "22:00",
                    "endTime": "07:00",
                    "timezone": "UTC",
                },
            },
            "privacy": {},
            "security": {"biometricLoginEnabled": False, "twoFactorEnabled": False},
            "sessions": {},
            "legal": {},
        }
    )
    monkeypatch.setattr(
        customer_app_contract_service,
        "db",
        SimpleNamespace(user_settings=fake_collection),
    )

    result = await customer_app_contract_service.update_security_preferences_contract(
        customer_id="customer-123",
        payload=SecurityPreferencesPatchContract(twoFactorEnabled=True),
    )

    assert result.biometricLoginEnabled is False
    assert result.twoFactorEnabled is True
    assert fake_collection.last_update_args is not None
    query, update_doc, upsert = fake_collection.last_update_args
    assert query == {"userId": "customer-123"}
    assert upsert is True
    assert "security" in update_doc["$set"]
    assert "notifications" not in update_doc["$set"]
