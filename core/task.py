from core.queue.tasks import task
from repositories.tokens_repo import delete_access_and_refresh_token_with_user_id
from services.payment_service import reconcile_pending_payments


@task("delete_tokens")
async def delete_tokens_task(userId: str) -> bool:
    return await delete_access_and_refresh_token_with_user_id(userId=userId)


@task("reconcile_pending_payments")
async def reconcile_pending_payments_task(limit: int = 50) -> dict[str, int]:
    return await reconcile_pending_payments(limit=limit)
