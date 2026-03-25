from __future__ import annotations

from bson import ObjectId
from fastapi import HTTPException

from core.queue.manager import QueueManager
from repositories.system_broadcast import create_system_broadcast, delete_system_broadcast, get_system_broadcast, get_system_broadcasts, update_system_broadcast
from schemas.system_broadcast import SystemBroadcastCreate, SystemBroadcastOut, SystemBroadcastUpdate


async def add_system_broadcast(payload: SystemBroadcastCreate) -> SystemBroadcastOut:
    return await create_system_broadcast(payload)


async def retrieve_system_broadcast_by_id(*, id: str) -> SystemBroadcastOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await get_system_broadcast({"_id": ObjectId(id)})
    if result is None:
        raise HTTPException(status_code=404, detail="SystemBroadcast not found")
    return result


async def retrieve_system_broadcasts(*, filters: dict | None = None, start: int = 0, stop: int = 100) -> list[SystemBroadcastOut]:
    return await get_system_broadcasts(filter_dict=filters or {}, start=start, stop=stop)


async def update_system_broadcast_by_id(*, id: str, payload: SystemBroadcastUpdate) -> SystemBroadcastOut:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    result = await update_system_broadcast({"_id": ObjectId(id)}, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="SystemBroadcast not found")
    return result


async def remove_system_broadcast(*, id: str) -> bool:
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid identifier format")
    deleted = await delete_system_broadcast({"_id": ObjectId(id)})
    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="SystemBroadcast not found")
    return True


async def dispatch_system_broadcast(payload: SystemBroadcastCreate) -> dict[str, object]:
    created = await create_system_broadcast(payload)
    enqueued = False
    try:
        QueueManager.get_instance().enqueue(
            "admin_system_broadcast_dispatch",
            {"broadcast_id": created.id, "audience": created.audience, "channel": created.channel},
        )
        enqueued = True
    except Exception:
        enqueued = False
    return {"broadcast": created, "enqueued": enqueued}
