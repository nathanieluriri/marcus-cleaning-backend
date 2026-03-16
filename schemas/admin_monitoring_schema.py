from __future__ import annotations

import time
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MonitoringSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    HIGH = "high"
    CRITICAL = "critical"


class MonitoringEventType(str, Enum):
    ADMIN_LOGIN_ATTEMPT = "ADMIN_LOGIN_ATTEMPT"
    ADMIN_LOGIN_SUCCESS = "ADMIN_LOGIN_SUCCESS"
    ADMIN_LOGIN_FAILURE = "ADMIN_LOGIN_FAILURE"
    ADMIN_REFRESH_ATTEMPT = "ADMIN_REFRESH_ATTEMPT"
    ADMIN_REFRESH_FAILURE = "ADMIN_REFRESH_FAILURE"
    ADMIN_REFRESH_ANOMALY = "ADMIN_REFRESH_ANOMALY"
    ADMIN_SESSION_CREATED = "ADMIN_SESSION_CREATED"
    ADMIN_SESSION_REVOKED = "ADMIN_SESSION_REVOKED"
    ADMIN_TOKEN_REPLAY_SUSPECTED = "ADMIN_TOKEN_REPLAY_SUSPECTED"
    ADMIN_PERMISSION_DENIED = "ADMIN_PERMISSION_DENIED"
    ADMIN_PERMISSION_TEMPLATE_CHANGED = "ADMIN_PERMISSION_TEMPLATE_CHANGED"
    ADMIN_PERMISSION_ROLLOUT = "ADMIN_PERMISSION_ROLLOUT"
    ADMIN_ONBOARDING_REVIEW_ACTION = "ADMIN_ONBOARDING_REVIEW_ACTION"


class MonitoringActorRef(BaseModel):
    actor_id: str | None = None
    actor_role: str | None = None
    actor_email: str | None = None


class MonitoringTargetRef(BaseModel):
    target_id: str | None = None
    target_type: str | None = None


class MonitoringRequestContext(BaseModel):
    request_id: str | None = None
    event_id: str
    endpoint: str | None = None
    method: str | None = None
    path: str | None = None
    ip: str | None = None
    ip_range: str | None = None
    user_agent: str | None = None
    fingerprint: str | None = None
    geo_hint: str | None = None
    asn: str | None = None
    network: str | None = None


class MonitoringEventCreate(BaseModel):
    event_type: MonitoringEventType
    severity: MonitoringSeverity = MonitoringSeverity.INFO
    actor: MonitoringActorRef = Field(default_factory=MonitoringActorRef)
    target: MonitoringTargetRef = Field(default_factory=MonitoringTargetRef)
    request: MonitoringRequestContext
    status_code: int | None = None
    reason: str | None = None
    payload_hash: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    date_created: int = Field(default_factory=lambda: int(time.time()))
    date_created_iso_utc: str = Field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


class MonitoringEventOut(MonitoringEventCreate):
    id: str | None = Field(default=None, alias="_id")
    prev_hash: str | None = None
    event_hash: str | None = None
    stream_key: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_id(cls, values: Any):
        if isinstance(values, dict) and "_id" in values:
            values["_id"] = str(values.get("_id"))
        return values

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class SecurityAlertCreate(BaseModel):
    rule_key: str
    dedup_key: str
    severity: MonitoringSeverity
    title: str
    summary: str
    details: dict[str, Any] = Field(default_factory=dict)
    actor_id: str | None = None
    target_id: str | None = None
    request_id: str | None = None
    status: str = "open"
    is_read: bool = False
    ack_owner_id: str | None = None
    ack_at: int | None = None
    last_fired_at: int = Field(default_factory=lambda: int(time.time()))
    date_created: int = Field(default_factory=lambda: int(time.time()))


class SecurityAlertOut(SecurityAlertCreate):
    id: str | None = Field(default=None, alias="_id")

    @model_validator(mode="before")
    @classmethod
    def _normalize_id(cls, values: Any):
        if isinstance(values, dict) and "_id" in values:
            values["_id"] = str(values.get("_id"))
        return values

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


class AdminMonitoringOverviewOut(BaseModel):
    login_failures_last_hour: int
    login_success_last_hour: int
    refresh_failures_last_hour: int
    open_alert_count: int
    high_alert_count: int
    critical_alert_count: int
    active_admin_sessions: int
    suspicious_login_successes_last_day: int


class AuthHeatmapCell(BaseModel):
    day_of_week: int
    hour_of_day: int
    success_count: int
    failure_count: int


class AuthHeatmapOut(BaseModel):
    items: list[AuthHeatmapCell]


class DeniedPermissionItem(BaseModel):
    permission_key: str
    deny_count: int
    admins: list[str] = Field(default_factory=list)


class DeniedPermissionsTopOut(BaseModel):
    items: list[DeniedPermissionItem]


class SessionAnomaliesOut(BaseModel):
    active_sessions_by_admin: dict[str, int]
    global_active_sessions: int
    long_lived_session_count: int
    recent_session_spike_detected: bool


class AlertSLAOut(BaseModel):
    mtta_seconds: float
    mttr_seconds: float
    acknowledged_count: int
    resolved_count: int


class AlertAcknowledgeIn(BaseModel):
    ack: bool = True


class AlertReadIn(BaseModel):
    is_read: bool = True


class AuditExportRequest(BaseModel):
    actor_id: str | None = None
    target_id: str | None = None
    endpoint: str | None = None
    start_epoch: int | None = None
    end_epoch: int | None = None
    limit: int = Field(default=500, ge=1, le=5000)


class AuditExportOut(BaseModel):
    items: list[MonitoringEventOut]
