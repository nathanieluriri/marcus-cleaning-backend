from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from typing import Any

from core.database import db
from schemas.admin_monitoring_schema import MonitoringEventCreate, MonitoringEventOut, SecurityAlertCreate, SecurityAlertOut


def _collection(name: str):
    return getattr(db, name)


def _stable_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def _build_event_hash(payload: dict[str, Any], prev_hash: str | None) -> str:
    hasher = hashlib.sha256()
    hasher.update((prev_hash or "").encode("utf-8"))
    hasher.update(_stable_json(payload).encode("utf-8"))
    return hasher.hexdigest()


async def append_monitor_event(event: MonitoringEventCreate) -> MonitoringEventOut:
    event_payload = event.model_dump(mode="json")
    stream_key = f"{event.event_type.value}:{event.actor.actor_id or 'unknown'}"

    previous = await _collection("admin_monitor_events").find_one(
        {"stream_key": stream_key},
        sort=[("date_created", -1)],
    )
    prev_hash = None if previous is None else str(previous.get("event_hash") or "")
    event_hash = _build_event_hash(event_payload, prev_hash)

    to_insert = {
        **event_payload,
        "stream_key": stream_key,
        "prev_hash": prev_hash,
        "event_hash": event_hash,
    }
    result = await _collection("admin_monitor_events").insert_one(to_insert)
    created = await _collection("admin_monitor_events").find_one({"_id": result.inserted_id})
    return MonitoringEventOut(**created)


async def create_or_update_counter(*, counter_key: str, window_seconds: int, increment: int = 1) -> int:
    now = int(time.time())
    bucket_start = now - (now % max(window_seconds, 1))
    result = await _collection("admin_auth_counters").find_one_and_update(
        {"counter_key": counter_key, "bucket_start": bucket_start},
        {
            "$inc": {"count": increment},
            "$setOnInsert": {
                "counter_key": counter_key,
                "bucket_start": bucket_start,
                "window_seconds": window_seconds,
                "date_created": now,
            },
            "$set": {"last_updated": now},
        },
        upsert=True,
        return_document=True,
    )
    if not result:
        return increment
    return int(result.get("count") or 0)


async def rolling_counter_total(*, key_prefix: str, since_epoch: int) -> int:
    cursor = _collection("admin_auth_counters").find(
        {"counter_key": {"$regex": f"^{key_prefix}"}, "bucket_start": {"$gte": since_epoch}}
    )
    total = 0
    async for row in cursor:
        total += int(row.get("count") or 0)
    return total


async def upsert_device_registry(*, admin_id: str, fingerprint: str, request_meta: dict[str, Any]) -> bool:
    now = int(time.time())
    result = await _collection("admin_device_registry").find_one_and_update(
        {"admin_id": admin_id, "fingerprint": fingerprint},
        {
            "$setOnInsert": {
                "admin_id": admin_id,
                "fingerprint": fingerprint,
                "first_seen_at": now,
                "first_seen_request": request_meta,
            },
            "$set": {"last_seen_at": now, "last_seen_request": request_meta},
        },
        upsert=True,
        return_document=True,
    )
    return bool(result and result.get("first_seen_at") == result.get("last_seen_at"))


async def upsert_network_registry(*, admin_id: str, network: str, asn: str | None, request_meta: dict[str, Any]) -> bool:
    now = int(time.time())
    result = await _collection("admin_network_registry").find_one_and_update(
        {"admin_id": admin_id, "network": network},
        {
            "$setOnInsert": {
                "admin_id": admin_id,
                "network": network,
                "asn": asn,
                "first_seen_at": now,
                "first_seen_request": request_meta,
            },
            "$set": {"last_seen_at": now, "last_seen_request": request_meta},
        },
        upsert=True,
        return_document=True,
    )
    return bool(result and result.get("first_seen_at") == result.get("last_seen_at"))


async def create_or_update_alert(alert: SecurityAlertCreate, cooldown_seconds: int) -> tuple[SecurityAlertOut, bool]:
    now = int(time.time())
    existing = await _collection("admin_security_alerts").find_one({"dedup_key": alert.dedup_key})
    if existing:
        last_fired_at = int(existing.get("last_fired_at") or 0)
        if now - last_fired_at < cooldown_seconds:
            updated = await _collection("admin_security_alerts").find_one_and_update(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "last_fired_at": now,
                        "summary": alert.summary,
                        "details": alert.details,
                        "severity": alert.severity.value,
                    }
                },
                return_document=True,
            )
            return SecurityAlertOut(**updated), False

    payload = alert.model_dump(mode="json")
    payload["severity"] = alert.severity.value
    result = await _collection("admin_security_alerts").insert_one(payload)
    created = await _collection("admin_security_alerts").find_one({"_id": result.inserted_id})
    return SecurityAlertOut(**created), True


async def list_alerts(*, status: str | None, unread_only: bool, start: int, stop: int) -> list[SecurityAlertOut]:
    query: dict[str, Any] = {}
    if status:
        query["status"] = status
    if unread_only:
        query["is_read"] = False

    limit = max(stop - start, 0)
    cursor = _collection("admin_security_alerts").find(query).sort("date_created", -1).skip(start).limit(limit)
    rows: list[SecurityAlertOut] = []
    async for row in cursor:
        rows.append(SecurityAlertOut(**row))
    return rows


async def mark_alert_read(*, alert_id: str, is_read: bool) -> SecurityAlertOut | None:
    from bson import ObjectId

    row = await _collection("admin_security_alerts").find_one_and_update(
        {"_id": ObjectId(alert_id)},
        {"$set": {"is_read": is_read, "read_at": int(time.time()) if is_read else None}},
        return_document=True,
    )
    if not row:
        return None
    return SecurityAlertOut(**row)


async def acknowledge_alert(*, alert_id: str, ack_owner_id: str | None) -> SecurityAlertOut | None:
    from bson import ObjectId

    payload: dict[str, Any] = {
        "ack_owner_id": ack_owner_id,
        "ack_at": int(time.time()) if ack_owner_id else None,
    }
    row = await _collection("admin_security_alerts").find_one_and_update(
        {"_id": ObjectId(alert_id)},
        {"$set": payload},
        return_document=True,
    )
    if not row:
        return None
    return SecurityAlertOut(**row)


async def count_alerts(*, severities: list[str] | None = None, status: str | None = None) -> int:
    query: dict[str, Any] = {}
    if severities:
        query["severity"] = {"$in": severities}
    if status:
        query["status"] = status
    return await _collection("admin_security_alerts").count_documents(query)


async def count_events(*, event_types: list[str], since_epoch: int) -> int:
    return await _collection("admin_monitor_events").count_documents(
        {"event_type": {"$in": event_types}, "date_created": {"$gte": since_epoch}}
    )


async def auth_heatmap(*, since_epoch: int) -> list[dict[str, Any]]:
    rows = _collection("admin_monitor_events").find(
        {
            "event_type": {
                "$in": [
                    "ADMIN_LOGIN_SUCCESS",
                    "ADMIN_LOGIN_FAILURE",
                ]
            },
            "date_created": {"$gte": since_epoch},
        }
    )
    buckets: dict[tuple[int, int], dict[str, Any]] = {}
    async for row in rows:
        ts = int(row.get("date_created") or time.time())
        dt = time.gmtime(ts)
        key = (dt.tm_wday, dt.tm_hour)
        if key not in buckets:
            buckets[key] = {
                "day_of_week": dt.tm_wday,
                "hour_of_day": dt.tm_hour,
                "success_count": 0,
                "failure_count": 0,
            }
        if row.get("event_type") == "ADMIN_LOGIN_SUCCESS":
            buckets[key]["success_count"] += 1
        else:
            buckets[key]["failure_count"] += 1
    return list(buckets.values())


async def top_denied_permissions(*, since_epoch: int, limit: int = 10) -> list[dict[str, Any]]:
    rows = _collection("admin_monitor_events").find(
        {
            "event_type": "ADMIN_PERMISSION_DENIED",
            "date_created": {"$gte": since_epoch},
        }
    )
    aggregate: dict[str, dict[str, Any]] = defaultdict(lambda: {"deny_count": 0, "admins": set()})
    async for row in rows:
        permission_key = str((row.get("details") or {}).get("permission_key") or "unknown")
        aggregate[permission_key]["deny_count"] += 1
        actor_id = str((row.get("actor") or {}).get("actor_id") or "")
        if actor_id:
            aggregate[permission_key]["admins"].add(actor_id)

    sorted_items = sorted(
        aggregate.items(),
        key=lambda item: item[1]["deny_count"],
        reverse=True,
    )[:limit]
    output = []
    for key, value in sorted_items:
        output.append(
            {
                "permission_key": key,
                "deny_count": value["deny_count"],
                "admins": sorted(value["admins"]),
            }
        )
    return output


async def export_audit_events(
    *,
    actor_id: str | None,
    target_id: str | None,
    endpoint: str | None,
    start_epoch: int | None,
    end_epoch: int | None,
    limit: int,
) -> list[MonitoringEventOut]:
    query: dict[str, Any] = {}
    if actor_id:
        query["actor.actor_id"] = actor_id
    if target_id:
        query["target.target_id"] = target_id
    if endpoint:
        query["request.endpoint"] = endpoint
    if start_epoch is not None or end_epoch is not None:
        date_query: dict[str, Any] = {}
        if start_epoch is not None:
            date_query["$gte"] = start_epoch
        if end_epoch is not None:
            date_query["$lte"] = end_epoch
        query["date_created"] = date_query

    cursor = _collection("admin_monitor_events").find(query).sort("date_created", -1).limit(limit)
    rows: list[MonitoringEventOut] = []
    async for row in cursor:
        rows.append(MonitoringEventOut(**row))
    return rows


async def record_delivery_log(*, alert_id: str, channel: str, status: str, detail: str | None = None) -> None:
    await _collection("admin_alert_delivery_logs").insert_one(
        {
            "alert_id": alert_id,
            "channel": channel,
            "status": status,
            "detail": detail,
            "date_created": int(time.time()),
        }
    )


async def active_sessions_by_admin() -> dict[str, int]:
    cursor = _collection("accessToken").find({"role": "admin", "status": "active"})
    counts: dict[str, int] = defaultdict(int)
    async for row in cursor:
        user_id = str(row.get("userId") or "")
        if user_id:
            counts[user_id] += 1
    return dict(counts)


async def global_session_creation_count(*, since_epoch: int) -> int:
    return await _collection("admin_monitor_events").count_documents(
        {
            "event_type": "ADMIN_SESSION_CREATED",
            "date_created": {"$gte": since_epoch},
        }
    )


async def latest_successful_login_geo(*, admin_id: str) -> dict[str, Any] | None:
    row = await _collection("admin_monitor_events").find_one(
        {
            "event_type": "ADMIN_LOGIN_SUCCESS",
            "actor.actor_id": admin_id,
            "details.geo": {"$exists": True},
        },
        sort=[("date_created", -1)],
    )
    if not row:
        return None
    return row.get("details", {}).get("geo")


async def alert_sla_metrics(*, since_epoch: int) -> dict[str, Any]:
    cursor = _collection("admin_security_alerts").find({"date_created": {"$gte": since_epoch}})

    ack_durations: list[int] = []
    resolve_durations: list[int] = []

    async for row in cursor:
        created = int(row.get("date_created") or 0)
        ack_at = row.get("ack_at")
        read_at = row.get("read_at")
        if isinstance(ack_at, int) and ack_at >= created > 0:
            ack_durations.append(ack_at - created)
        if isinstance(read_at, int) and read_at >= created > 0:
            resolve_durations.append(read_at - created)

    def _avg(values: list[int]) -> float:
        if not values:
            return 0.0
        return float(sum(values) / len(values))

    return {
        "mtta_seconds": _avg(ack_durations),
        "mttr_seconds": _avg(resolve_durations),
        "acknowledged_count": len(ack_durations),
        "resolved_count": len(resolve_durations),
    }
