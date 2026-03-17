from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import logging
import math
import os
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from ipaddress import ip_address, ip_network
from typing import Any

import requests
from fastapi import Request
from fastapi import HTTPException, status
from bson import ObjectId

from core.settings import get_settings
from core.queue.manager import QueueManager
from core.storage.local_provider import LocalStorageProvider
from core.storage.manager import DocumentStorageManager
from repositories.admin_monitoring_repo import (
    acknowledge_alert,
    active_sessions_by_admin,
    alert_sla_metrics,
    append_monitor_event,
    count_audit_events,
    auth_heatmap,
    count_alerts,
    count_events,
    create_audit_export_job,
    create_or_update_alert,
    create_or_update_counter,
    export_audit_events,
    get_audit_export_job,
    get_audit_event_by_id,
    get_alert_by_id,
    global_session_creation_count,
    latest_successful_login_geo,
    list_alerts,
    list_audit_events,
    mark_alert_read,
    record_delivery_log,
    rolling_counter_total,
    top_denied_permissions,
    update_audit_export_job,
    upsert_device_registry,
    upsert_network_registry,
)
from schemas.admin_monitoring_schema import (
    AdminMonitoringOverviewOut,
    AlertSLAOut,
    AlertAcknowledgeIn,
    AlertReadIn,
    AuditActor,
    AuditActorType,
    AuditChange,
    AuditEvent,
    AuditEventType,
    AuditExportStatusOut,
    AuditExportOut,
    AuditExportRequest,
    AuditHistoryPagination,
    AuditHistoryQuery,
    AuditHistoryResponse,
    AuditHttpMethod,
    AuditPermission,
    AuditRedactionLevel,
    AuditRelated,
    AuditSeverity,
    AuditSort,
    AuditStatus,
    AuditTarget,
    AuditTargetType,
    AuthHeatmapCell,
    AuthHeatmapOut,
    DeniedPermissionItem,
    DeniedPermissionsTopOut,
    MonitoringActorRef,
    MonitoringEventCreate,
    MonitoringEventOut,
    MonitoringEventType,
    MonitoringRequestContext,
    MonitoringSeverity,
    MonitoringTargetRef,
    SecurityAlertCreate,
    SessionAnomaliesOut,
)

logger = logging.getLogger(__name__)
settings = get_settings()

_LEGACY_TO_CANONICAL_EVENT_TYPE: dict[str, str] = {
    MonitoringEventType.ADMIN_LOGIN_SUCCESS.value: AuditEventType.ADMIN_LOGIN_SUCCEEDED.value,
    MonitoringEventType.ADMIN_LOGIN_FAILURE.value: AuditEventType.ADMIN_LOGIN_FAILED.value,
    MonitoringEventType.ADMIN_REFRESH_ATTEMPT.value: AuditEventType.ADMIN_TOKEN_REFRESHED.value,
    MonitoringEventType.ADMIN_SESSION_REVOKED.value: AuditEventType.ADMIN_SESSION_REVOKED.value,
    MonitoringEventType.ADMIN_PERMISSION_DENIED.value: AuditEventType.PERMISSION_DENIED.value,
    MonitoringEventType.ADMIN_PERMISSION_TEMPLATE_CHANGED.value: AuditEventType.PERMISSION_TEMPLATE_UPDATED.value,
    MonitoringEventType.ADMIN_PERMISSION_ROLLOUT.value: AuditEventType.PERMISSION_TEMPLATE_ROLLED_OUT.value,
    MonitoringEventType.ADMIN_ONBOARDING_REVIEW_ACTION.value: AuditEventType.CLEANER_ONBOARDING_REVIEWED.value,
    MonitoringEventType.ADMIN_MONITORING_ALERT_ACKNOWLEDGED.value: AuditEventType.MONITORING_ALERT_ACKNOWLEDGED.value,
    MonitoringEventType.ADMIN_MONITORING_ALERT_READ_STATE_CHANGED.value: AuditEventType.MONITORING_ALERT_READ_STATE_CHANGED.value,
    MonitoringEventType.ADMIN_MONITORING_ALERT_CREATED.value: "monitoring_alert_created",
}

_CANONICAL_TO_LEGACY_EVENT_TYPE = {value: key for key, value in _LEGACY_TO_CANONICAL_EVENT_TYPE.items()}


@dataclass(frozen=True)
class MonitoringContext:
    request_id: str | None
    endpoint: str | None
    method: str | None
    path: str | None
    ip: str | None
    ip_range: str | None
    user_agent: str | None
    fingerprint: str | None
    geo_hint: str | None
    asn: str | None
    network: str | None


def _safe_env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
        return value if value > 0 else default
    except ValueError:
        return default


def _utc_iso(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_ip_range(ip_raw: str | None) -> str | None:
    if not ip_raw:
        return None
    try:
        parsed = ip_address(ip_raw)
    except ValueError:
        return None

    if parsed.version == 4:
        network = ip_network(f"{parsed}/24", strict=False)
    else:
        network = ip_network(f"{parsed}/64", strict=False)
    return str(network)


def _extract_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _fingerprint(user_agent: str | None, ip: str | None) -> str | None:
    if not user_agent and not ip:
        return None
    payload = f"{user_agent or ''}|{_normalize_ip_range(ip) or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _redact_email(email: str | None) -> str | None:
    if not email or "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = "*" * len(local)
    else:
        masked_local = local[0] + ("*" * (len(local) - 2)) + local[-1]
    return f"{masked_local}@{domain}"


def _redact_map(data: dict[str, Any]) -> dict[str, Any]:
    blocked = {
        "password",
        "refresh_token",
        "access_token",
        "id_token",
        "token",
        "authorization",
        "card_number",
        "account_number",
        "bank_account",
        "document_number",
    }
    result: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in blocked:
            result[key] = "[REDACTED]"
            continue
        if isinstance(value, dict):
            result[key] = _redact_map(value)
            continue
        if isinstance(value, str) and "@" in value and key.lower().endswith("email"):
            result[key] = _redact_email(value)
            continue
        result[key] = value
    return result


def _resource_from_path(path: str | None) -> str | None:
    if not path:
        return None
    segments = [segment for segment in path.strip("/").split("/") if segment]
    if not segments:
        return None
    if segments[0] == "v1" and len(segments) > 1:
        return segments[1]
    return segments[0]


def _canonical_event_type(raw_event_type: str | None) -> str:
    if not raw_event_type:
        return AuditEventType.AUDIT_EXPORT_REQUESTED.value
    return _LEGACY_TO_CANONICAL_EVENT_TYPE.get(raw_event_type, raw_event_type.lower())


def _canonical_status(*, event_type: str | None, status_code: int | None, severity: str | None) -> AuditStatus:
    if severity == MonitoringSeverity.CRITICAL.value:
        return AuditStatus.CRITICAL
    if severity == MonitoringSeverity.WARNING.value and (status_code is None or status_code < 400):
        return AuditStatus.WARNING
    if status_code == 403 or event_type == MonitoringEventType.ADMIN_PERMISSION_DENIED.value:
        return AuditStatus.DENIED
    if isinstance(status_code, int) and status_code >= 400:
        return AuditStatus.FAILED
    return AuditStatus.SUCCESS


def _canonical_action(*, event_type: str, endpoint: str | None, method: str | None) -> str:
    if event_type == AuditEventType.CLEANER_ONBOARDING_REVIEWED.value:
        return "onboarding.review"
    if event_type == AuditEventType.PERMISSION_DENIED.value:
        return "permission.denied"
    if event_type == AuditEventType.PERMISSION_TEMPLATE_UPDATED.value:
        return "permission.template.update"
    if event_type == AuditEventType.PERMISSION_TEMPLATE_ROLLED_OUT.value:
        return "permission.template.rollout"
    if event_type == "monitoring_alert_created":
        return "alert.created"
    if event_type == AuditEventType.MONITORING_ALERT_ACKNOWLEDGED.value:
        return "alert.ack"
    if event_type == AuditEventType.MONITORING_ALERT_READ_STATE_CHANGED.value:
        return "alert.read_state_changed"
    if endpoint and method:
        return f"{method.lower()}.{endpoint.strip('/')}"
    if endpoint:
        return endpoint
    return event_type


def _summary_from_event(*, event_type: str, status: AuditStatus, details: dict[str, Any], reason: str | None) -> str:
    if event_type == AuditEventType.CLEANER_ONBOARDING_REVIEWED.value:
        status_value = str(details.get("status") or "").upper() or "UPDATED"
        return f"Admin reviewed cleaner onboarding: {status_value}"
    if event_type == AuditEventType.PERMISSION_DENIED.value:
        permission_key = str(details.get("permission_key") or "unknown")
        return f"Permission denied for {permission_key}"
    if reason:
        return reason
    return f"Audit event {event_type} ({status.value})"


def _apply_redaction(*, details: dict[str, Any], redaction: AuditRedactionLevel) -> dict[str, Any]:
    if redaction == AuditRedactionLevel.NONE:
        return details
    if redaction == AuditRedactionLevel.STANDARD:
        return _redact_map(details)
    return _redact_map(details)


def _map_monitoring_event_to_audit(
    event: MonitoringEventOut,
    *,
    include_payload: bool,
    include_related: bool,
    redaction: AuditRedactionLevel,
) -> AuditEvent:
    request = event.request
    details = dict(event.details or {})
    event_type = _canonical_event_type(event.event_type.value if isinstance(event.event_type, MonitoringEventType) else str(event.event_type))
    status = _canonical_status(
        event_type=event.event_type.value if isinstance(event.event_type, MonitoringEventType) else str(event.event_type),
        status_code=event.status_code,
        severity=event.severity.value if isinstance(event.severity, MonitoringSeverity) else str(event.severity),
    )
    method_value = request.method if request and request.method in {m.value for m in AuditHttpMethod} else None
    endpoint_value = request.path or request.endpoint if request else None
    actor_id = event.actor.actor_id or "system"
    actor_type_value = event.actor.actor_role if event.actor.actor_role in {m.value for m in AuditActorType} else "system"

    payload_redacted: dict[str, Any] | None = None
    if include_payload:
        payload_redacted = _apply_redaction(details=details, redaction=redaction)

    related: AuditRelated | None = None
    if include_related:
        related = AuditRelated(
            alert_ids=[str(details["alert_id"])] if "alert_id" in details else None,
            session_id=str(details["session_id"]) if "session_id" in details else None,
            correlated_request_ids=details.get("correlated_request_ids"),
        )

    permission: AuditPermission | None = None
    permission_key = details.get("permission_key")
    if permission_key:
        permission = AuditPermission(
            key=str(permission_key),
            decision="denied" if status == AuditStatus.DENIED else "allowed",
            source="role_template",
        )

    changes: list[AuditChange] | None = None
    if "status" in details and event_type == AuditEventType.CLEANER_ONBOARDING_REVIEWED.value:
        changes = [AuditChange(field="onboarding_status", before="PENDING", after=details.get("status"))]

    return AuditEvent(
        id=str(event.id or ""),
        timestamp=event.date_created,
        date_created=event.date_created,
        request_id=request.request_id if request else None,
        trace_id=None,
        span_id=None,
        actor=AuditActor(
            id=actor_id,
            type=AuditActorType(actor_type_value),
            display_name=event.actor.actor_email or actor_id,
            email=event.actor.actor_email,
        ),
        target=AuditTarget(
            id=str(event.target.target_id or "unknown"),
            type=str(event.target.target_type or "unknown"),
            display_name=str(event.target.target_id or "unknown"),
        )
        if event.target and event.target.target_id
        else None,
        event_type=event_type,
        action=_canonical_action(event_type=event_type, endpoint=endpoint_value, method=method_value),
        summary=_summary_from_event(event_type=event_type, status=status, details=details, reason=event.reason),
        method=AuditHttpMethod(method_value) if method_value else None,
        endpoint=endpoint_value,
        resource=_resource_from_path(endpoint_value),
        status=status,
        http_status_code=event.status_code,
        severity=AuditSeverity(event.severity.value) if event.severity else None,
        ip_address=request.ip if request else None,
        user_agent=request.user_agent if request else None,
        geo=None,
        permission=permission,
        payload_redacted=payload_redacted,
        changes=changes,
        related=related,
        tags=details.get("tags"),
        risk_score=details.get("risk_score"),
    )


def _build_audit_db_query(query: AuditHistoryQuery) -> dict[str, Any]:
    db_query: dict[str, Any] = {}
    if query.actor_id:
        db_query["actor.actor_id"] = query.actor_id
    if query.actor_type:
        db_query["actor.actor_role"] = query.actor_type.value
    if query.target_id:
        db_query["target.target_id"] = query.target_id
    if query.target_type:
        db_query["target.target_type"] = query.target_type.value
    if query.endpoint:
        escaped = re.escape(query.endpoint)
        db_query["request.path"] = {"$regex": escaped}
    if query.method:
        db_query["request.method"] = query.method.value
    if query.event_type:
        legacy_values: list[str] = []
        for value in query.event_type:
            legacy_values.append(_CANONICAL_TO_LEGACY_EVENT_TYPE.get(value.value, value.value.upper()))
        db_query["event_type"] = {"$in": legacy_values}
    if query.request_id:
        db_query["request.request_id"] = query.request_id
    if query.ip:
        db_query["request.ip"] = query.ip
    if query.severity:
        db_query["severity"] = query.severity.value
    if query.from_epoch is not None or query.to_epoch is not None:
        date_query: dict[str, Any] = {}
        if query.from_epoch is not None:
            date_query["$gte"] = query.from_epoch
        if query.to_epoch is not None:
            date_query["$lte"] = query.to_epoch
        db_query["date_created"] = date_query
    if query.tags:
        db_query["details.tags"] = {"$all": query.tags}
    if query.status == AuditStatus.DENIED:
        db_query["status_code"] = 403
    elif query.status == AuditStatus.SUCCESS:
        db_query["status_code"] = {"$gte": 200, "$lt": 400}
    elif query.status == AuditStatus.FAILED:
        db_query["status_code"] = {"$gte": 400}
    elif query.status == AuditStatus.WARNING:
        db_query["severity"] = MonitoringSeverity.WARNING.value
    elif query.status == AuditStatus.CRITICAL:
        db_query["severity"] = MonitoringSeverity.CRITICAL.value
    return db_query


def _build_export_query_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    def _enum_or_none(enum_cls, raw):
        if raw is None:
            return None
        try:
            return enum_cls(raw)
        except Exception:
            return None

    raw_event_type = payload.get("event_type")
    event_types: list[AuditEventType] | None = None
    if isinstance(raw_event_type, str) and raw_event_type.strip():
        event_types = []
        for token in raw_event_type.split(","):
            normalized = token.strip()
            if not normalized:
                continue
            parsed = _enum_or_none(AuditEventType, normalized)
            if parsed:
                event_types.append(parsed)
    elif isinstance(raw_event_type, list):
        event_types = []
        for token in raw_event_type:
            parsed = _enum_or_none(AuditEventType, str(token).strip())
            if parsed:
                event_types.append(parsed)

    query_model = AuditHistoryQuery(
        actor_id=payload.get("actor_id"),
        actor_type=_enum_or_none(AuditActorType, payload.get("actor_type")),
        target_id=payload.get("target_id"),
        target_type=_enum_or_none(AuditTargetType, payload.get("target_type")),
        endpoint=payload.get("endpoint"),
        method=_enum_or_none(AuditHttpMethod, payload.get("method")),
        status=_enum_or_none(AuditStatus, payload.get("status")),
        event_type=event_types,
        request_id=payload.get("request_id"),
        ip=payload.get("ip"),
        from_epoch=payload.get("from_epoch"),
        to_epoch=payload.get("to_epoch"),
        severity=_enum_or_none(AuditSeverity, payload.get("severity")),
        tags=payload.get("tags") if isinstance(payload.get("tags"), list) else None,
        include_payload=bool(payload.get("include_payload", False)),
        include_related=False,
        start=0,
        stop=min(int(payload.get("limit") or 5000), 200),
    )
    return _build_audit_db_query(query_model)


async def _augment_audit_query_for_alert_target(
    *,
    query: AuditHistoryQuery,
    db_query: dict[str, Any],
) -> dict[str, Any]:
    if not query.target_id:
        return db_query
    if query.target_type not in {None, AuditTargetType.ALERT}:
        return db_query

    alert = await get_alert_by_id(alert_id=query.target_id)
    if alert is None:
        return db_query

    or_clauses: list[dict[str, Any]] = [
        {"target.target_id": query.target_id},
        {"details.alert_id": query.target_id},
    ]
    if alert.request_id and not query.request_id:
        or_clauses.append({"request.request_id": alert.request_id})

    base_query = dict(db_query)
    base_query.pop("target.target_id", None)
    if not base_query:
        return {"$or": or_clauses}
    return {"$and": [base_query, {"$or": or_clauses}]}


async def _fetch_geo_metadata(ip: str | None) -> dict[str, Any]:
    if not ip:
        return {}

    provider_url = os.getenv("MONITORING_GEO_PROVIDER_URL")
    provider_key = os.getenv("MONITORING_GEO_PROVIDER_KEY")
    if not provider_url:
        return {}

    timeout_seconds = _safe_env_int("MONITORING_GEO_PROVIDER_TIMEOUT_SECONDS", 2)

    def _do_request() -> dict[str, Any]:
        try:
            headers = {"Accept": "application/json"}
            if provider_key:
                headers["Authorization"] = f"Bearer {provider_key}"
            response = requests.get(
                provider_url,
                params={"ip": ip},
                timeout=timeout_seconds,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
            if not isinstance(payload, dict):
                return {}
            return payload
        except Exception:
            return {}

    data = await asyncio.to_thread(_do_request)
    city = str(data.get("city") or "").strip()
    country = str(data.get("country") or data.get("country_code") or "").strip()
    asn = str(data.get("asn") or "").strip() or None
    network = str(data.get("network") or "").strip() or None
    latitude = data.get("latitude")
    longitude = data.get("longitude")

    output: dict[str, Any] = {}
    if city or country:
        output["geo_hint"] = ", ".join(part for part in [city, country] if part)
    if asn:
        output["asn"] = asn
    if network:
        output["network"] = network
    if isinstance(latitude, (float, int)) and isinstance(longitude, (float, int)):
        output["geo"] = {"lat": float(latitude), "lon": float(longitude), "city": city, "country": country}
    return output


def build_monitoring_context_from_request(request: Request) -> MonitoringContext:
    endpoint = request.scope.get("endpoint")
    endpoint_name = endpoint.__name__ if endpoint else None
    ip = _extract_ip(request)
    user_agent = request.headers.get("User-Agent")
    return MonitoringContext(
        request_id=getattr(request.state, "request_id", None),
        endpoint=endpoint_name,
        method=request.method,
        path=request.url.path,
        ip=ip,
        ip_range=_normalize_ip_range(ip),
        user_agent=user_agent,
        fingerprint=_fingerprint(user_agent, ip),
        geo_hint=None,
        asn=None,
        network=None,
    )


def _build_request_context(context: MonitoringContext) -> MonitoringRequestContext:
    return MonitoringRequestContext(
        request_id=context.request_id,
        event_id=str(uuid.uuid4()),
        endpoint=context.endpoint,
        method=context.method,
        path=context.path,
        ip=context.ip,
        ip_range=context.ip_range,
        user_agent=context.user_agent,
        fingerprint=context.fingerprint,
        geo_hint=context.geo_hint,
        asn=context.asn,
        network=context.network,
    )


def _hash_payload(payload: dict[str, Any] | None) -> str | None:
    if not payload:
        return None
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def _send_webhook_alert(alert_id: str, payload: dict[str, Any]) -> None:
    url = os.getenv("ADMIN_MONITORING_ALERT_WEBHOOK_URL")
    if not url:
        return

    timeout_seconds = _safe_env_int("ADMIN_MONITORING_ALERT_WEBHOOK_TIMEOUT_SECONDS", 3)

    def _send() -> tuple[bool, str]:
        try:
            response = requests.post(url, json=payload, timeout=timeout_seconds)
            response.raise_for_status()
            return True, f"http:{response.status_code}"
        except Exception as err:
            return False, str(err)

    ok, detail = await asyncio.to_thread(_send)
    await record_delivery_log(
        alert_id=alert_id,
        channel="webhook",
        status="sent" if ok else "failed",
        detail=detail,
    )


async def _send_email_alert(alert_id: str, payload: dict[str, Any]) -> None:
    recipient_csv = os.getenv("ADMIN_MONITORING_ALERT_EMAIL_RECIPIENTS")
    if not recipient_csv:
        return

    recipients = [item.strip() for item in recipient_csv.split(",") if item.strip()]
    if not recipients:
        return

    from services.email_service import (
        EMAIL_HOST,
        EMAIL_PASSWORD,
        EMAIL_PORT,
        EMAIL_USERNAME,
        send_html_email_optimized,
    )

    subject = f"[Admin Monitoring][{payload.get('severity', '').upper()}] {payload.get('title', 'Alert')}"
    plain = payload.get("summary", "")
    html = (
        f"<h3>{payload.get('title', 'Alert')}</h3>"
        f"<p>{payload.get('summary', '')}</p>"
        f"<pre>{json.dumps(payload.get('details', {}), indent=2, default=str)}</pre>"
    )

    async def _send_to(recipient: str) -> None:
        def _send() -> None:
            send_html_email_optimized(
                sender_email=EMAIL_USERNAME,
                sender_display_name="Admin Monitoring",
                receiver_email=recipient,
                subject=subject,
                html_content=html,
                plain_text_content=plain,
                smtp_server=EMAIL_HOST,
                smtp_port=EMAIL_PORT,
                smtp_login=EMAIL_USERNAME,
                smtp_password=EMAIL_PASSWORD,
            )

        try:
            await asyncio.to_thread(_send)
            await record_delivery_log(alert_id=alert_id, channel="email", status="sent", detail=recipient)
        except Exception as err:
            await record_delivery_log(alert_id=alert_id, channel="email", status="failed", detail=str(err))

    await asyncio.gather(*[_send_to(recipient) for recipient in recipients])


async def _dispatch_alert(alert_id: str, payload: dict[str, Any]) -> None:
    await asyncio.gather(
        _send_webhook_alert(alert_id, payload),
        _send_email_alert(alert_id, payload),
    )


def _cooldown_seconds_for_severity(severity: MonitoringSeverity) -> int:
    if severity == MonitoringSeverity.CRITICAL:
        return _safe_env_int("ADMIN_MONITORING_COOLDOWN_CRITICAL_SECONDS", 300)
    if severity == MonitoringSeverity.HIGH:
        return _safe_env_int("ADMIN_MONITORING_COOLDOWN_HIGH_SECONDS", 900)
    if severity == MonitoringSeverity.WARNING:
        return _safe_env_int("ADMIN_MONITORING_COOLDOWN_WARNING_SECONDS", 900)
    return _safe_env_int("ADMIN_MONITORING_COOLDOWN_INFO_SECONDS", 300)


async def _raise_security_alert(
    *,
    rule_key: str,
    dedup_key: str,
    severity: MonitoringSeverity,
    title: str,
    summary: str,
    details: dict[str, Any],
    actor_id: str | None,
    target_id: str | None,
    request_id: str | None,
) -> None:
    alert = SecurityAlertCreate(
        rule_key=rule_key,
        dedup_key=dedup_key,
        severity=severity,
        title=title,
        summary=summary,
        details=details,
        actor_id=actor_id,
        target_id=target_id,
        request_id=request_id,
    )
    created_alert, created_new = await create_or_update_alert(
        alert=alert,
        cooldown_seconds=_cooldown_seconds_for_severity(severity),
    )
    if not created_new:
        return

    payload = {
        "alert_id": created_alert.id,
        "rule_key": rule_key,
        "severity": severity.value,
        "title": title,
        "summary": summary,
        "details": details,
        "request_id": request_id,
        "date_created": created_alert.date_created,
        "date_created_iso_utc": _utc_iso(created_alert.date_created),
    }
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_MONITORING_ALERT_CREATED,
        severity=severity,
        context=MonitoringContext(
            request_id=request_id,
            endpoint="monitoring_alert_engine",
            method=None,
            path="/v1/admins/monitoring/alerts",
            ip=None,
            ip_range=None,
            user_agent=None,
            fingerprint=None,
            geo_hint=None,
            asn=None,
            network=None,
        ),
        actor_id=actor_id,
        actor_email=None,
        target_id=str(created_alert.id or ""),
        target_type="alert",
        status_code=201,
        reason="monitoring_alert_created",
        details={
            "alert_id": str(created_alert.id or ""),
            "rule_key": rule_key,
            "severity": severity.value,
            "source_request_id": request_id,
        },
    )
    asyncio.create_task(_dispatch_alert(str(created_alert.id or ""), payload))


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


async def _detect_bruteforce(*, admin_email: str | None, context: MonitoringContext, request_id: str | None) -> None:
    now = int(time.time())
    window_seconds = _safe_env_int("ADMIN_MONITORING_BRUTEFORCE_WINDOW_SECONDS", 300)
    threshold = _safe_env_int("ADMIN_MONITORING_BRUTEFORCE_THRESHOLD", 10)
    since_epoch = now - window_seconds

    key_prefix = "admin_login_failure"
    total = await rolling_counter_total(key_prefix=key_prefix, since_epoch=since_epoch)
    if total < threshold:
        return

    await _raise_security_alert(
        rule_key="admin_bruteforce_window",
        dedup_key=f"admin_bruteforce:{context.ip_range or context.ip or 'unknown'}",
        severity=MonitoringSeverity.HIGH,
        title="Possible brute-force login activity",
        summary=f"Detected {total} admin login failures within the rolling window.",
        details={
            "window_seconds": window_seconds,
            "failure_count": total,
            "ip": context.ip,
            "ip_range": context.ip_range,
            "admin_email": _redact_email(admin_email),
        },
        actor_id=None,
        target_id=None,
        request_id=request_id,
    )


async def _detect_suspicious_success_after_failures(
    *,
    admin_id: str,
    context: MonitoringContext,
    request_id: str | None,
) -> None:
    now = int(time.time())
    window_seconds = _safe_env_int("ADMIN_MONITORING_SUSPICIOUS_SUCCESS_WINDOW_SECONDS", 1800)
    threshold = _safe_env_int("ADMIN_MONITORING_SUSPICIOUS_SUCCESS_FAILURE_THRESHOLD", 5)
    since_epoch = now - window_seconds

    total_admin_failures = await rolling_counter_total(
        key_prefix=f"admin_login_failure:admin:{admin_id}",
        since_epoch=since_epoch,
    )
    if total_admin_failures < threshold:
        return

    await _raise_security_alert(
        rule_key="admin_suspicious_success_after_failures",
        dedup_key=f"admin_suspicious_success:{admin_id}",
        severity=MonitoringSeverity.HIGH,
        title="Suspicious successful login after repeated failures",
        summary="Admin login succeeded after a suspicious streak of failures.",
        details={
            "admin_id": admin_id,
            "failure_count": total_admin_failures,
            "window_seconds": window_seconds,
            "ip": context.ip,
            "fingerprint": context.fingerprint,
        },
        actor_id=admin_id,
        target_id=admin_id,
        request_id=request_id,
    )


async def _detect_impossible_travel(
    *,
    admin_id: str,
    geo: dict[str, Any] | None,
    context: MonitoringContext,
    request_id: str | None,
) -> None:
    if not geo or "lat" not in geo or "lon" not in geo:
        return

    previous_geo = await latest_successful_login_geo(admin_id=admin_id)
    if not previous_geo:
        return
    prev_lat = previous_geo.get("lat")
    prev_lon = previous_geo.get("lon")
    if not isinstance(prev_lat, (float, int)) or not isinstance(prev_lon, (float, int)):
        return

    distance = _distance_km(float(prev_lat), float(prev_lon), float(geo["lat"]), float(geo["lon"]))
    if distance < _safe_env_int("ADMIN_MONITORING_IMPOSSIBLE_TRAVEL_MIN_KM", 1000):
        return

    await _raise_security_alert(
        rule_key="admin_impossible_travel",
        dedup_key=f"admin_impossible_travel:{admin_id}",
        severity=MonitoringSeverity.WARNING,
        title="Possible impossible travel login",
        summary="Login location changed too far from the previous successful location.",
        details={
            "admin_id": admin_id,
            "distance_km": round(distance, 2),
            "previous_geo": previous_geo,
            "current_geo": geo,
            "ip": context.ip,
        },
        actor_id=admin_id,
        target_id=admin_id,
        request_id=request_id,
    )


async def _detect_session_anomalies(*, admin_id: str | None, request_id: str | None) -> None:
    if not admin_id:
        return

    admin_sessions = await active_sessions_by_admin()
    current = int(admin_sessions.get(admin_id) or 0)
    threshold = _safe_env_int("ADMIN_MONITORING_CONCURRENT_SESSION_THRESHOLD", 5)
    if current >= threshold:
        await _raise_security_alert(
            rule_key="admin_high_concurrent_sessions",
            dedup_key=f"admin_high_concurrent_sessions:{admin_id}",
            severity=MonitoringSeverity.WARNING,
            title="High concurrent admin sessions",
            summary="Admin account has unusually high concurrent sessions.",
            details={
                "admin_id": admin_id,
                "active_sessions": current,
                "threshold": threshold,
            },
            actor_id=admin_id,
            target_id=admin_id,
            request_id=request_id,
        )

    now = int(time.time())
    recent = await global_session_creation_count(since_epoch=now - 15 * 60)
    baseline = await global_session_creation_count(since_epoch=now - 30 * 60)
    baseline = max(baseline - recent, 1)
    multiplier = float(os.getenv("ADMIN_MONITORING_SESSION_SPIKE_MULTIPLIER", "3"))
    if recent >= int(baseline * multiplier):
        await _raise_security_alert(
            rule_key="admin_global_session_spike",
            dedup_key="admin_global_session_spike",
            severity=MonitoringSeverity.WARNING,
            title="Global admin session creation spike",
            summary="Admin session creation volume exceeded baseline expectations.",
            details={
                "recent_15m": recent,
                "baseline_prev_15m": baseline,
                "multiplier": multiplier,
            },
            actor_id=None,
            target_id=None,
            request_id=request_id,
        )


async def emit_admin_event(
    *,
    event_type: MonitoringEventType,
    severity: MonitoringSeverity,
    context: MonitoringContext,
    actor_id: str | None,
    actor_email: str | None,
    target_id: str | None,
    target_type: str | None,
    status_code: int | None,
    reason: str | None,
    details: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    enriched_context = context
    geo_meta = await _fetch_geo_metadata(context.ip)
    if geo_meta:
        enriched_context = MonitoringContext(
            request_id=context.request_id,
            endpoint=context.endpoint,
            method=context.method,
            path=context.path,
            ip=context.ip,
            ip_range=context.ip_range,
            user_agent=context.user_agent,
            fingerprint=context.fingerprint,
            geo_hint=str(geo_meta.get("geo_hint") or context.geo_hint),
            asn=str(geo_meta.get("asn") or context.asn) if geo_meta.get("asn") else context.asn,
            network=str(geo_meta.get("network") or context.network) if geo_meta.get("network") else context.network,
        )

    event_details = _redact_map(details or {})
    if "geo" in geo_meta:
        event_details["geo"] = geo_meta["geo"]

    created = await append_monitor_event(
        MonitoringEventCreate(
            event_type=event_type,
            severity=severity,
            actor=MonitoringActorRef(actor_id=actor_id, actor_role="admin", actor_email=_redact_email(actor_email)),
            target=MonitoringTargetRef(target_id=target_id, target_type=target_type),
            request=_build_request_context(enriched_context),
            status_code=status_code,
            reason=reason,
            details=event_details,
            payload_hash=_hash_payload(_redact_map(payload or {})),
        )
    )

    now = int(time.time())
    if event_type == MonitoringEventType.ADMIN_LOGIN_FAILURE:
        await create_or_update_counter(counter_key="admin_login_failure", window_seconds=300)
        if actor_id:
            await create_or_update_counter(counter_key=f"admin_login_failure:admin:{actor_id}", window_seconds=300)
        if enriched_context.ip:
            await create_or_update_counter(counter_key=f"admin_login_failure:ip:{enriched_context.ip}", window_seconds=300)
        if enriched_context.ip_range:
            await create_or_update_counter(
                counter_key=f"admin_login_failure:iprange:{enriched_context.ip_range}",
                window_seconds=300,
            )

        await _detect_bruteforce(
            admin_email=actor_email,
            context=enriched_context,
            request_id=enriched_context.request_id,
        )

    if event_type == MonitoringEventType.ADMIN_LOGIN_SUCCESS:
        await create_or_update_counter(counter_key="admin_login_success", window_seconds=3600)
        if actor_id and enriched_context.fingerprint:
            first_device = await upsert_device_registry(
                admin_id=actor_id,
                fingerprint=enriched_context.fingerprint,
                request_meta={
                    "request_id": enriched_context.request_id,
                    "ip": enriched_context.ip,
                    "user_agent": enriched_context.user_agent,
                },
            )
            if first_device:
                await _raise_security_alert(
                    rule_key="admin_first_seen_device",
                    dedup_key=f"admin_first_seen_device:{actor_id}:{enriched_context.fingerprint}",
                    severity=MonitoringSeverity.INFO,
                    title="First-seen admin device fingerprint",
                    summary="Admin logged in from a device/browser fingerprint not seen before.",
                    details={
                        "admin_id": actor_id,
                        "fingerprint": enriched_context.fingerprint,
                        "ip": enriched_context.ip,
                    },
                    actor_id=actor_id,
                    target_id=actor_id,
                    request_id=enriched_context.request_id,
                )

        if actor_id and enriched_context.network:
            first_network = await upsert_network_registry(
                admin_id=actor_id,
                network=enriched_context.network,
                asn=enriched_context.asn,
                request_meta={
                    "request_id": enriched_context.request_id,
                    "ip": enriched_context.ip,
                    "geo_hint": enriched_context.geo_hint,
                },
            )
            if first_network:
                await _raise_security_alert(
                    rule_key="admin_first_seen_network",
                    dedup_key=f"admin_first_seen_network:{actor_id}:{enriched_context.network}",
                    severity=MonitoringSeverity.INFO,
                    title="First-seen admin network",
                    summary="Admin logged in from a network/ASN not seen before.",
                    details={
                        "admin_id": actor_id,
                        "network": enriched_context.network,
                        "asn": enriched_context.asn,
                        "ip": enriched_context.ip,
                    },
                    actor_id=actor_id,
                    target_id=actor_id,
                    request_id=enriched_context.request_id,
                )

        if actor_id:
            await _detect_suspicious_success_after_failures(
                admin_id=actor_id,
                context=enriched_context,
                request_id=enriched_context.request_id,
            )
            await _detect_impossible_travel(
                admin_id=actor_id,
                geo=event_details.get("geo"),
                context=enriched_context,
                request_id=enriched_context.request_id,
            )

    if event_type == MonitoringEventType.ADMIN_REFRESH_FAILURE:
        refresh_failure_window = _safe_env_int("ADMIN_MONITORING_REFRESH_FAILURE_WINDOW_SECONDS", 900)
        refresh_failure_threshold = _safe_env_int("ADMIN_MONITORING_REFRESH_FAILURE_THRESHOLD", 5)
        if actor_id:
            await create_or_update_counter(
                counter_key=f"admin_refresh_failure:admin:{actor_id}",
                window_seconds=refresh_failure_window,
            )
            failures = await rolling_counter_total(
                key_prefix=f"admin_refresh_failure:admin:{actor_id}",
                since_epoch=now - refresh_failure_window,
            )
            if failures >= refresh_failure_threshold:
                await _raise_security_alert(
                    rule_key="admin_refresh_repeated_failures",
                    dedup_key=f"admin_refresh_repeated_failures:{actor_id}",
                    severity=MonitoringSeverity.WARNING,
                    title="Repeated refresh failures",
                    summary="Refresh flow repeatedly failed for this admin.",
                    details={
                        "admin_id": actor_id,
                        "failures": failures,
                        "window_seconds": refresh_failure_window,
                    },
                    actor_id=actor_id,
                    target_id=actor_id,
                    request_id=enriched_context.request_id,
                )

    if event_type == MonitoringEventType.ADMIN_REFRESH_ATTEMPT and actor_id:
        churn_window = _safe_env_int("ADMIN_MONITORING_REFRESH_CHURN_WINDOW_SECONDS", 600)
        churn_threshold = _safe_env_int("ADMIN_MONITORING_REFRESH_CHURN_THRESHOLD", 6)
        await create_or_update_counter(
            counter_key=f"admin_refresh_attempt:admin:{actor_id}",
            window_seconds=churn_window,
        )
        churn_total = await rolling_counter_total(
            key_prefix=f"admin_refresh_attempt:admin:{actor_id}",
            since_epoch=now - churn_window,
        )
        if churn_total >= churn_threshold:
            await _raise_security_alert(
                rule_key="admin_refresh_churn",
                dedup_key=f"admin_refresh_churn:{actor_id}",
                severity=MonitoringSeverity.WARNING,
                title="Rapid refresh token churn",
                summary="Refresh token usage is unusually high for one admin.",
                details={
                    "admin_id": actor_id,
                    "refresh_attempts": churn_total,
                    "window_seconds": churn_window,
                },
                actor_id=actor_id,
                target_id=actor_id,
                request_id=enriched_context.request_id,
            )

    if event_type == MonitoringEventType.ADMIN_SESSION_CREATED:
        await _detect_session_anomalies(admin_id=actor_id, request_id=enriched_context.request_id)

    if event_type == MonitoringEventType.ADMIN_TOKEN_REPLAY_SUSPECTED:
        await _raise_security_alert(
            rule_key="admin_token_replay",
            dedup_key=f"admin_token_replay:{actor_id or 'unknown'}",
            severity=MonitoringSeverity.HIGH,
            title="Possible token replay detected",
            summary="Observed token behavior consistent with replay indicators.",
            details={
                "actor_id": actor_id,
                "reason": reason,
            },
            actor_id=actor_id,
            target_id=target_id,
            request_id=enriched_context.request_id,
        )

    if event_type == MonitoringEventType.ADMIN_PERMISSION_DENIED:
        await create_or_update_counter(counter_key="admin_permission_denied", window_seconds=3600)

    _ = created


async def log_admin_login_attempt(
    *,
    request: Request,
    success: bool,
    email: str | None,
    admin_id: str | None,
    reason: str | None,
    status_code: int,
) -> None:
    context = build_monitoring_context_from_request(request)
    event_type = MonitoringEventType.ADMIN_LOGIN_SUCCESS if success else MonitoringEventType.ADMIN_LOGIN_FAILURE
    severity = MonitoringSeverity.INFO if success else MonitoringSeverity.WARNING

    await emit_admin_event(
        event_type=event_type,
        severity=severity,
        context=context,
        actor_id=admin_id,
        actor_email=email,
        target_id=admin_id,
        target_type="admin",
        status_code=status_code,
        reason=reason,
        details={
            "login_result": "success" if success else "failure",
            "email": _redact_email(email),
        },
        payload={"email": _redact_email(email)},
    )

    if success:
        await emit_admin_event(
            event_type=MonitoringEventType.ADMIN_SESSION_CREATED,
            severity=MonitoringSeverity.INFO,
            context=context,
            actor_id=admin_id,
            actor_email=email,
            target_id=admin_id,
            target_type="admin_session",
            status_code=200,
            reason="login_issued_session",
            details={"source": "login"},
        )


async def log_admin_refresh_attempt(
    *,
    request: Request,
    success: bool,
    admin_id: str | None,
    reason: str | None,
    status_code: int,
    invalid_refresh_reuse: bool = False,
) -> None:
    context = build_monitoring_context_from_request(request)

    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_REFRESH_ATTEMPT,
        severity=MonitoringSeverity.INFO,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=admin_id,
        target_type="admin",
        status_code=status_code,
        reason="refresh_attempt",
        details={"success": success},
    )

    if success:
        await emit_admin_event(
            event_type=MonitoringEventType.ADMIN_SESSION_CREATED,
            severity=MonitoringSeverity.INFO,
            context=context,
            actor_id=admin_id,
            actor_email=None,
            target_id=admin_id,
            target_type="admin_session",
            status_code=status_code,
            reason="refresh_issued_session",
            details={"source": "refresh"},
        )
        return

    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_REFRESH_FAILURE,
        severity=MonitoringSeverity.WARNING,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=admin_id,
        target_type="admin",
        status_code=status_code,
        reason=reason,
        details={"invalid_refresh_reuse": invalid_refresh_reuse},
    )
    if invalid_refresh_reuse:
        await emit_admin_event(
            event_type=MonitoringEventType.ADMIN_TOKEN_REPLAY_SUSPECTED,
            severity=MonitoringSeverity.HIGH,
            context=context,
            actor_id=admin_id,
            actor_email=None,
            target_id=admin_id,
            target_type="admin",
            status_code=status_code,
            reason="invalid_refresh_reuse",
            details={"invalid_refresh_reuse": True},
        )


async def log_admin_session_revocation(
    *,
    request: Request,
    admin_id: str | None,
    reason: str,
    revoked_access_sessions: int,
    revoked_refresh_sessions: int,
) -> None:
    context = build_monitoring_context_from_request(request)
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_SESSION_REVOKED,
        severity=MonitoringSeverity.INFO,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=admin_id,
        target_type="admin_session",
        status_code=200,
        reason=reason,
        details={
            "revoked_access_sessions": revoked_access_sessions,
            "revoked_refresh_sessions": revoked_refresh_sessions,
        },
    )


async def log_admin_permission_denied(
    *,
    request: Request,
    admin_id: str | None,
    admin_email: str | None,
    permission_key: str,
) -> None:
    context = build_monitoring_context_from_request(request)
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_PERMISSION_DENIED,
        severity=MonitoringSeverity.WARNING,
        context=context,
        actor_id=admin_id,
        actor_email=admin_email,
        target_id=admin_id,
        target_type="admin",
        status_code=403,
        reason="permission_denied",
        details={"permission_key": permission_key},
    )


async def log_permission_template_change(
    *,
    request: Request,
    admin_id: str,
    role: str,
    before_payload: dict[str, Any] | None,
    after_payload: dict[str, Any],
) -> None:
    context = build_monitoring_context_from_request(request)
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_PERMISSION_TEMPLATE_CHANGED,
        severity=MonitoringSeverity.INFO,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=role,
        target_type="role_permission_template",
        status_code=200,
        reason="template_updated",
        details={
            "role": role,
            "before_hash": _hash_payload(before_payload or {}),
            "after_hash": _hash_payload(after_payload),
        },
    )


async def log_permission_rollout(
    *,
    request: Request,
    admin_id: str,
    role: str,
    matched_count: int,
    modified_count: int,
) -> None:
    context = build_monitoring_context_from_request(request)
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_PERMISSION_ROLLOUT,
        severity=MonitoringSeverity.INFO,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=role,
        target_type="role_permission_rollout",
        status_code=200,
        reason="permission_rollout",
        details={"role": role, "matched_count": matched_count, "modified_count": modified_count},
    )


async def log_onboarding_review_action(
    *,
    request: Request,
    admin_id: str,
    cleaner_id: str,
    status_value: str,
    rejection_reason: str | None,
    latency_seconds: int | None,
) -> None:
    context = build_monitoring_context_from_request(request)
    details = {
        "status": status_value,
        "has_rejection_reason": bool(rejection_reason),
        "latency_seconds": latency_seconds,
    }
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_ONBOARDING_REVIEW_ACTION,
        severity=MonitoringSeverity.INFO,
        context=context,
        actor_id=admin_id,
        actor_email=None,
        target_id=cleaner_id,
        target_type="cleaner_onboarding",
        status_code=200,
        reason="onboarding_review",
        details=details,
    )

    if status_value.upper() == "REJECTED" and not rejection_reason:
        await _raise_security_alert(
            rule_key="admin_onboarding_reject_missing_reason",
            dedup_key=f"admin_onboarding_reject_missing_reason:{admin_id}:{cleaner_id}",
            severity=MonitoringSeverity.WARNING,
            title="Onboarding rejection missing reason",
            summary="An admin rejected onboarding without providing a reason.",
            details={"admin_id": admin_id, "cleaner_id": cleaner_id},
            actor_id=admin_id,
            target_id=cleaner_id,
            request_id=context.request_id,
        )


async def get_monitoring_overview() -> AdminMonitoringOverviewOut:
    now = int(time.time())
    one_hour = now - 3600
    one_day = now - 86400

    login_failures = await count_events(event_types=[MonitoringEventType.ADMIN_LOGIN_FAILURE.value], since_epoch=one_hour)
    login_successes = await count_events(event_types=[MonitoringEventType.ADMIN_LOGIN_SUCCESS.value], since_epoch=one_hour)
    refresh_failures = await count_events(event_types=[MonitoringEventType.ADMIN_REFRESH_FAILURE.value], since_epoch=one_hour)
    suspicious = await count_alerts(status="open", severities=None)

    sessions = await active_sessions_by_admin()
    return AdminMonitoringOverviewOut(
        login_failures_last_hour=login_failures,
        login_success_last_hour=login_successes,
        refresh_failures_last_hour=refresh_failures,
        open_alert_count=suspicious,
        high_alert_count=await count_alerts(severities=[MonitoringSeverity.HIGH.value], status="open"),
        critical_alert_count=await count_alerts(severities=[MonitoringSeverity.CRITICAL.value], status="open"),
        active_admin_sessions=sum(sessions.values()),
        suspicious_login_successes_last_day=await count_alerts(
            severities=[MonitoringSeverity.HIGH.value],
            status="open",
        ),
    )


async def get_auth_heatmap(*, days: int = 14) -> AuthHeatmapOut:
    since_epoch = int(time.time()) - max(days, 1) * 86400
    items = await auth_heatmap(since_epoch=since_epoch)
    return AuthHeatmapOut(items=[AuthHeatmapCell(**item) for item in items])


async def get_top_denied_permissions(*, hours: int = 24, limit: int = 10) -> DeniedPermissionsTopOut:
    since_epoch = int(time.time()) - max(hours, 1) * 3600
    items = await top_denied_permissions(since_epoch=since_epoch, limit=limit)
    return DeniedPermissionsTopOut(items=[DeniedPermissionItem(**item) for item in items])


async def get_session_anomalies() -> SessionAnomaliesOut:
    sessions = await active_sessions_by_admin()
    now = int(time.time())
    recent = await global_session_creation_count(since_epoch=now - 15 * 60)
    previous = await global_session_creation_count(since_epoch=now - 30 * 60)
    baseline = max(previous - recent, 1)
    multiplier = float(os.getenv("ADMIN_MONITORING_SESSION_SPIKE_MULTIPLIER", "3"))
    spike = recent >= int(baseline * multiplier)

    long_lived_threshold_seconds = _safe_env_int("ADMIN_MONITORING_LONG_LIVED_SESSION_SECONDS", 86400)
    long_lived = await count_events(
        event_types=[MonitoringEventType.ADMIN_SESSION_CREATED.value],
        since_epoch=0,
    )
    # Approximation: older than threshold derived from total sessions created minus recent window events.
    recent_sessions = await count_events(
        event_types=[MonitoringEventType.ADMIN_SESSION_CREATED.value],
        since_epoch=now - long_lived_threshold_seconds,
    )

    return SessionAnomaliesOut(
        active_sessions_by_admin=sessions,
        global_active_sessions=sum(sessions.values()),
        long_lived_session_count=max(long_lived - recent_sessions, 0),
        recent_session_spike_detected=spike,
    )


async def list_monitoring_alerts(*, status: str | None, unread_only: bool, start: int, stop: int):
    return await list_alerts(status=status, unread_only=unread_only, start=start, stop=stop)


async def set_alert_read_state(
    *,
    request: Request,
    alert_id: str,
    actor_id: str | None,
    payload: AlertReadIn,
):
    item = await mark_alert_read(alert_id=alert_id, is_read=payload.is_read)
    if item is None:
        return None
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_MONITORING_ALERT_READ_STATE_CHANGED,
        severity=MonitoringSeverity.INFO,
        context=build_monitoring_context_from_request(request),
        actor_id=actor_id,
        actor_email=None,
        target_id=alert_id,
        target_type="alert",
        status_code=200,
        reason="monitoring_alert_read_state_changed",
        details={
            "alert_id": alert_id,
            "is_read": payload.is_read,
            "rule_key": item.rule_key,
            "alert_request_id": item.request_id,
        },
    )
    return item


async def acknowledge_monitoring_alert(
    *,
    request: Request,
    alert_id: str,
    actor_id: str | None,
    payload: AlertAcknowledgeIn,
):
    ack_owner = actor_id if payload.ack else None
    item = await acknowledge_alert(alert_id=alert_id, ack_owner_id=ack_owner)
    if item is None:
        return None
    await emit_admin_event(
        event_type=MonitoringEventType.ADMIN_MONITORING_ALERT_ACKNOWLEDGED,
        severity=MonitoringSeverity.INFO,
        context=build_monitoring_context_from_request(request),
        actor_id=actor_id,
        actor_email=None,
        target_id=alert_id,
        target_type="alert",
        status_code=200,
        reason="monitoring_alert_acknowledged",
        details={
            "alert_id": alert_id,
            "ack": payload.ack,
            "rule_key": item.rule_key,
            "alert_request_id": item.request_id,
        },
    )
    return item


async def list_monitoring_audit(
    *,
    actor_id: str | None,
    actor_type: AuditActorType | None,
    target_id: str | None,
    target_type: AuditTargetType | None,
    endpoint: str | None,
    method: AuditHttpMethod | None,
    audit_status: AuditStatus | None,
    event_types: list[AuditEventType] | None,
    request_id: str | None,
    ip: str | None,
    from_epoch: int | None,
    to_epoch: int | None,
    severity: AuditSeverity | None,
    tags: list[str] | None,
    cursor: str | None,
    sort: AuditSort,
    include_payload: bool,
    include_related: bool,
    start: int,
    stop: int,
) -> AuditHistoryResponse:
    query = AuditHistoryQuery(
        actor_id=actor_id,
        actor_type=actor_type,
        target_id=target_id,
        target_type=target_type,
        endpoint=endpoint,
        method=method,
        status=audit_status,
        event_type=event_types,
        request_id=request_id,
        ip=ip,
        from_epoch=from_epoch,
        to_epoch=to_epoch,
        severity=severity,
        tags=tags,
        cursor=cursor,
        sort=sort,
        include_payload=include_payload,
        include_related=include_related,
        start=start,
        stop=stop,
    )
    db_query = _build_audit_db_query(query)
    db_query = await _augment_audit_query_for_alert_target(query=query, db_query=db_query)
    sort_desc = query.sort == AuditSort.DESC

    try:
        rows, total, next_cursor, has_more = await list_audit_events(
            query=db_query,
            sort_desc=sort_desc,
            start=0 if query.cursor else query.start,
            stop=query.stop,
            cursor_token=query.cursor,
        )
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid query parameters",
        ) from err

    items = [
        _map_monitoring_event_to_audit(
            item,
            include_payload=query.include_payload,
            include_related=query.include_related,
            redaction=AuditRedactionLevel.STRICT,
        )
        for item in rows
    ]

    return AuditHistoryResponse(
        items=items,
        pagination=AuditHistoryPagination(
            start=query.start,
            stop=query.stop,
            count=len(items),
            total=total,
            next_cursor=next_cursor,
            has_more=has_more,
        ),
        query={
            "sort": query.sort.value,
            "status": query.status.value if query.status else None,
            "actor_id": query.actor_id,
            "target_id": query.target_id,
            "endpoint": query.endpoint,
            "from_epoch": query.from_epoch,
            "to_epoch": query.to_epoch,
        },
    )


async def get_monitoring_audit_event(
    *,
    event_id: str,
    include_payload: bool = True,
    include_related: bool = True,
    redaction: AuditRedactionLevel = AuditRedactionLevel.STRICT,
    allow_unredacted: bool = False,
) -> AuditEvent:
    if not ObjectId.is_valid(event_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid audit event ID format")
    if redaction == AuditRedactionLevel.NONE and not allow_unredacted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Redaction level not permitted")

    item = await get_audit_event_by_id(event_id=event_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Monitoring audit event not found")
    return _map_monitoring_event_to_audit(
        item,
        include_payload=include_payload,
        include_related=include_related,
        redaction=redaction,
    )


async def export_monitoring_audit(payload: AuditExportRequest) -> AuditExportOut:
    event_type_tokens: list[str] = []
    if isinstance(payload.event_type, str):
        event_type_tokens = [item.strip() for item in payload.event_type.split(",") if item.strip()]
    elif isinstance(payload.event_type, list):
        for item in payload.event_type:
            for token in str(item).split(","):
                normalized = token.strip()
                if normalized:
                    event_type_tokens.append(normalized)

    parsed_event_types: list[AuditEventType] | None = None
    if event_type_tokens:
        parsed_event_types = []
        invalid_tokens: list[str] = []
        for token in event_type_tokens:
            try:
                parsed_event_types.append(AuditEventType(token))
            except ValueError:
                invalid_tokens.append(token)
        if invalid_tokens:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Invalid event_type values: {', '.join(sorted(set(invalid_tokens)))}",
            )

    query = AuditHistoryQuery(
        actor_id=payload.actor_id,
        actor_type=AuditActorType(payload.actor_type) if payload.actor_type else None,
        target_id=payload.target_id,
        target_type=AuditTargetType(payload.target_type) if payload.target_type else None,
        endpoint=payload.endpoint,
        method=AuditHttpMethod(payload.method) if payload.method else None,
        status=AuditStatus(payload.status) if payload.status else None,
        event_type=parsed_event_types,
        request_id=payload.request_id,
        ip=payload.ip,
        from_epoch=payload.from_epoch,
        to_epoch=payload.to_epoch,
        severity=AuditSeverity(payload.severity) if payload.severity else None,
        tags=payload.tags,
        include_payload=payload.include_payload,
        start=0,
        stop=min(payload.limit, 200),
    )
    db_query = _build_audit_db_query(query)
    estimated_rows = await count_audit_events(query=db_query)
    expires_at = int(time.time()) + 24 * 3600
    job = await create_audit_export_job(
        payload=payload.model_dump(mode="json"),
        export_query=db_query,
        export_limit=payload.limit,
        export_sort_desc=True,
        estimated_rows=estimated_rows,
        expires_at=expires_at,
        task_id=None,
    )
    download_url = f"/v1/admins/monitoring/audit/export/{str(job['export_id'])}/download"
    await update_audit_export_job(
        export_id=str(job["export_id"]),
        status="queued",
        download_url=download_url,
    )
    try:
        queue_job = QueueManager.get_instance().enqueue(
            "generate_audit_export",
            {
                "export_id": str(job["export_id"]),
                "query": db_query,
                "limit": payload.limit,
                "sort_desc": True,
            },
        )
        await update_audit_export_job(
            export_id=str(job["export_id"]),
            status="queued",
            task_id=getattr(queue_job, "task_id", None),
        )
    except Exception:
        asyncio.create_task(
            generate_audit_export(
                export_id=str(job["export_id"]),
                query=db_query,
                limit=payload.limit,
                sort_desc=True,
            )
        )
    return AuditExportOut(
        export_id=str(job["export_id"]),
        status="queued",
        estimated_rows=int(job["estimated_rows"]),
        download_url=download_url,
        expires_at=int(job["expires_at"]),
    )


async def get_monitoring_audit_export_status(*, export_id: str) -> AuditExportStatusOut:
    row = await get_audit_export_job(export_id=export_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit export job not found")

    raw_status = str(row.get("status") or "queued").lower()
    if raw_status in {"queued", "processing"}:
        task_id = row.get("task_id")
        if task_id:
            try:
                queue_status = str(QueueManager.get_instance().get_status(str(task_id)) or "").upper()
                if queue_status in {"STARTED", "RETRY", "RECEIVED"} and raw_status != "processing":
                    await update_audit_export_job(export_id=export_id, status="processing")
                elif queue_status in {"FAILURE", "REVOKED"}:
                    await update_audit_export_job(export_id=export_id, status="failed", error=f"worker status: {queue_status}")
            except Exception:
                pass

        refreshed = await get_audit_export_job(export_id=export_id)
        if refreshed is not None:
            row = refreshed

        created_at = int(row.get("date_created") or 0)
        is_stale_queued = str(row.get("status") or "").lower() == "queued" and (int(time.time()) - created_at) >= 30
        if is_stale_queued:
            execution_query = row.get("export_query")
            if not isinstance(execution_query, dict):
                execution_query = _build_export_query_from_payload(row.get("payload") or {})
            execution_limit = int(row.get("export_limit") or 5000)
            execution_sort_desc = bool(row.get("export_sort_desc") if row.get("export_sort_desc") is not None else True)
            await generate_audit_export(
                export_id=export_id,
                query=execution_query,
                limit=execution_limit,
                sort_desc=execution_sort_desc,
            )
            refreshed = await get_audit_export_job(export_id=export_id)
            if refreshed is not None:
                row = refreshed

    if not row.get("download_url"):
        row["download_url"] = f"/v1/admins/monitoring/audit/export/{export_id}/download"
    return AuditExportStatusOut(
        export_id=str(row.get("export_id") or export_id),
        status=str(row.get("status") or "queued"),
        estimated_rows=int(row["estimated_rows"]) if row.get("estimated_rows") is not None else None,
        download_url=row.get("download_url"),
        expires_at=int(row["expires_at"]) if row.get("expires_at") is not None else None,
        error=row.get("error"),
    )


def _csv_payload_for_events(rows: list[MonitoringEventOut]) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "timestamp",
            "request_id",
            "actor_id",
            "actor_type",
            "target_id",
            "target_type",
            "event_type",
            "action",
            "method",
            "endpoint",
            "status",
            "http_status_code",
            "severity",
            "ip_address",
            "summary",
        ]
    )
    for row in rows:
        event = _map_monitoring_event_to_audit(
            row,
            include_payload=False,
            include_related=False,
            redaction=AuditRedactionLevel.STRICT,
        )
        writer.writerow(
            [
                event.id,
                event.timestamp,
                event.request_id or "",
                event.actor.id,
                event.actor.type.value,
                event.target.id if event.target else "",
                event.target.type if event.target else "",
                event.event_type,
                event.action,
                event.method.value if event.method else "",
                event.endpoint or "",
                event.status.value,
                event.http_status_code or "",
                event.severity.value if event.severity else "",
                event.ip_address or "",
                event.summary or "",
            ]
        )
    return output.getvalue().encode("utf-8")


async def generate_audit_export(
    *,
    export_id: str,
    query: dict[str, Any],
    limit: int,
    sort_desc: bool = True,
) -> None:
    await update_audit_export_job(export_id=export_id, status="processing")
    try:
        rows = await export_audit_events(
            query=query,
            sort_desc=sort_desc,
            limit=limit,
        )
        payload = _csv_payload_for_events(rows)
        storage = DocumentStorageManager.get_instance().provider
        object_key = f"audit-exports/{export_id}.csv"
        storage.save_bytes(
            object_key=object_key,
            payload=payload,
            mime_type="text/csv",
        )
        await update_audit_export_job(
            export_id=export_id,
            status="ready",
            estimated_rows=len(rows),
            object_key=object_key,
        )
    except Exception as err:
        await update_audit_export_job(
            export_id=export_id,
            status="failed",
            error=str(err),
        )


async def download_monitoring_audit_export(*, export_id: str) -> tuple[bytes | None, str | None, str | None]:
    row = await get_audit_export_job(export_id=export_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit export job not found")
    if str(row.get("status") or "") != "ready":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Audit export is not ready")

    expires_at = int(row.get("expires_at") or 0)
    now = int(time.time())
    if expires_at <= now:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Audit export URL has expired")

    object_key = str(row.get("object_key") or "")
    if not object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit export artifact missing")

    provider = DocumentStorageManager.get_instance().provider
    if isinstance(provider, LocalStorageProvider):
        try:
            payload = provider.read_bytes(object_key=object_key)
        except FileNotFoundError as err:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit export artifact not found") from err
        filename = f"{export_id}.csv"
        return payload, "text/csv", filename

    download_url = provider.download_url(object_key=object_key, expires_in=max(min(expires_at - now, 900), 1))
    return None, download_url, None


async def get_alert_sla_metrics(*, hours: int = 24) -> AlertSLAOut:
    since_epoch = int(time.time()) - max(hours, 1) * 3600
    metrics = await alert_sla_metrics(since_epoch=since_epoch)
    return AlertSLAOut(**metrics)
