from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import admin_reporting_service


class _AsyncCursor:
    def __init__(self, rows):
        self._rows = rows
        self._index = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._rows):
            raise StopAsyncIteration
        row = self._rows[self._index]
        self._index += 1
        return row


@pytest.mark.asyncio
async def test_user_growth_summary_uses_date_window_counts(monkeypatch: pytest.MonkeyPatch):
    class _Collection:
        def __init__(self, docs_total: int, docs_period: int):
            self.docs_total = docs_total
            self.docs_period = docs_period

        async def count_documents(self, query):
            if not query:
                return self.docs_total
            if "date_created" in query:
                return self.docs_period
            if query == {"onboarding_status": "PENDING"}:
                return 2
            if query == {"onboarding_status": "APPROVED"}:
                return 5
            if query == {"onboarding_status": "REJECTED"}:
                return 1
            return 0

    fake_db = SimpleNamespace(
        customers=_Collection(docs_total=20, docs_period=6),
        cleaners=_Collection(docs_total=10, docs_period=3),
    )
    monkeypatch.setattr(admin_reporting_service, "db", fake_db)

    result = await admin_reporting_service.get_admin_user_growth_summary(from_epoch=10, to_epoch=20)
    assert result.total_customers == 20
    assert result.new_customers_period == 6
    assert result.pending_cleaner_onboarding == 2


@pytest.mark.asyncio
async def test_signup_trend_builds_bucketed_points(monkeypatch: pytest.MonkeyPatch):
    class _Collection:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query, projection):
            _ = query, projection
            return _AsyncCursor(self.rows)

    fake_db = SimpleNamespace(
        customers=_Collection(rows=[{"date_created": 86_400}, {"date_created": 86_401}]),
        cleaners=_Collection(rows=[{"date_created": 86_402}]),
    )
    monkeypatch.setattr(admin_reporting_service, "db", fake_db)

    result = await admin_reporting_service.get_admin_user_signup_trend(
        from_epoch=86_400,
        to_epoch=86_500,
        bucket="day",
    )
    assert result.points
    assert result.points[0].customers == 2
    assert result.points[0].cleaners == 1


@pytest.mark.asyncio
async def test_reporting_window_rejects_invalid_range():
    with pytest.raises(HTTPException) as exc_info:
        await admin_reporting_service.get_admin_user_growth_summary(from_epoch=20, to_epoch=10)
    assert exc_info.value.status_code == 422
