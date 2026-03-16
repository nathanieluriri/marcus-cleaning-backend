from __future__ import annotations

import pytest

from services import admin_monitoring_service


@pytest.mark.asyncio
async def test_get_alert_sla_metrics_maps_repo_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _stub_alert_sla_metrics(*, since_epoch: int):
        assert since_epoch > 0
        return {
            "mtta_seconds": 12.5,
            "mttr_seconds": 42.0,
            "acknowledged_count": 3,
            "resolved_count": 2,
        }

    monkeypatch.setattr(admin_monitoring_service, "alert_sla_metrics", _stub_alert_sla_metrics)

    result = await admin_monitoring_service.get_alert_sla_metrics(hours=24)

    assert result.mtta_seconds == 12.5
    assert result.mttr_seconds == 42.0
    assert result.acknowledged_count == 3
    assert result.resolved_count == 2
