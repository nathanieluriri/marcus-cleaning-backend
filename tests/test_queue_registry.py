import pytest
from core import task as _task_registration  # noqa: F401
from core.queue.tasks import execute_registered_task, list_registered_task_keys, register_task

@pytest.mark.asyncio
async def test_queue_registry_executes_task():
    async def _sample_task(value: int) -> int:
        return value + 1

    register_task("test_queue_registry_executes_task", _sample_task)
    result = await execute_registered_task(
        task_key="test_queue_registry_executes_task",
        payload={"value": 2},
    )
    assert result == 3


def test_queue_registry_contains_payment_reconciliation_task():
    assert "reconcile_pending_payments" in list_registered_task_keys()
