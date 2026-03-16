from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from ipaddress import ip_address, ip_network
from typing import Any

import requests
from fastapi import Request

from core.settings import get_settings
from repositories.admin_monitoring_repo import (
    acknowledge_alert,
    active_sessions_by_admin,
    alert_sla_metrics,
    append_monitor_event,
    auth_heatmap,
    count_alerts,
    count_events,
    create_or_update_alert,
    create_or_update_counter,
    export_audit_events,
    global_session_creation_count,
    latest_successful_login_geo,
    list_alerts,
    mark_alert_read,
    record_delivery_log,
    rolling_counter_total,
    top_denied_permissions,
    upsert_device_registry,
    upsert_network_registry,
)
from schemas.admin_monitoring_schema import (
    AdminMonitoringOverviewOut,
    AlertSLAOut,
    AlertAcknowledgeIn,
    AlertReadIn,
    AuditExportOut,
    AuditExportRequest,
    AuthHeatmapCell,
    AuthHeatmapOut,
    DeniedPermissionItem,
    DeniedPermissionsTopOut,
    MonitoringActorRef,
    MonitoringEventCreate,
    MonitoringEventType,
    MonitoringRequestContext,
    MonitoringSeverity,
    MonitoringTargetRef,
    SecurityAlertCreate,
    SessionAnomaliesOut,
)

logger = logging.getLogger(__name__)
settings = get_settings()


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
    blocked = {"password", "refresh_token", "token", "authorization"}
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


async def set_alert_read_state(*, alert_id: str, payload: AlertReadIn):
    return await mark_alert_read(alert_id=alert_id, is_read=payload.is_read)


async def acknowledge_monitoring_alert(*, alert_id: str, actor_id: str | None, payload: AlertAcknowledgeIn):
    ack_owner = actor_id if payload.ack else None
    return await acknowledge_alert(alert_id=alert_id, ack_owner_id=ack_owner)


async def export_monitoring_audit(payload: AuditExportRequest) -> AuditExportOut:
    rows = await export_audit_events(
        actor_id=payload.actor_id,
        target_id=payload.target_id,
        endpoint=payload.endpoint,
        start_epoch=payload.start_epoch,
        end_epoch=payload.end_epoch,
        limit=payload.limit,
    )
    return AuditExportOut(items=rows)


async def get_alert_sla_metrics(*, hours: int = 24) -> AlertSLAOut:
    since_epoch = int(time.time()) - max(hours, 1) * 3600
    metrics = await alert_sla_metrics(since_epoch=since_epoch)
    return AlertSLAOut(**metrics)
