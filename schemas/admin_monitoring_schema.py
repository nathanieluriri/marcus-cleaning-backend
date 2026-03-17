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
    ADMIN_MONITORING_ALERT_CREATED = "ADMIN_MONITORING_ALERT_CREATED"
    ADMIN_MONITORING_ALERT_ACKNOWLEDGED = "ADMIN_MONITORING_ALERT_ACKNOWLEDGED"
    ADMIN_MONITORING_ALERT_READ_STATE_CHANGED = "ADMIN_MONITORING_ALERT_READ_STATE_CHANGED"


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
    actor_type: str | None = None
    target_id: str | None = None
    target_type: str | None = None
    endpoint: str | None = None
    method: str | None = None
    status: str | None = None
    event_type: str | list[str] | None = None
    request_id: str | None = None
    ip: str | None = None
    from_epoch: int | None = None
    to_epoch: int | None = None
    severity: str | None = None
    tags: list[str] | None = None
    format: str = "csv"
    include_payload: bool = False
    limit: int = Field(default=500, ge=1, le=5000)

    @model_validator(mode="after")
    def _validate_time_window(self):
        if self.from_epoch is not None and self.to_epoch is not None and self.from_epoch > self.to_epoch:
            raise ValueError("from_epoch must be <= to_epoch")
        return self


class AuditSort(str, Enum):
    ASC = "asc"
    DESC = "desc"


class AuditActorType(str, Enum):
    ADMIN = "admin"
    SYSTEM = "system"
    CLEANER = "cleaner"
    CUSTOMER = "customer"
    SERVICE = "service"


class AuditTargetType(str, Enum):
    ADMIN = "admin"
    CLEANER = "cleaner"
    CUSTOMER = "customer"
    BOOKING = "booking"
    ROLE_TEMPLATE = "role_template"
    ALERT = "alert"
    SESSION = "session"
    PAYMENT = "payment"
    DOCUMENT = "document"


class AuditHttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class AuditStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    DENIED = "denied"
    WARNING = "warning"
    CRITICAL = "critical"


class AuditSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    HIGH = "high"
    CRITICAL = "critical"


class AuditRedactionLevel(str, Enum):
    STRICT = "strict"
    STANDARD = "standard"
    NONE = "none"


class AuditEventType(str, Enum):
    ADMIN_LOGIN_SUCCEEDED = "admin_login_succeeded"
    ADMIN_LOGIN_FAILED = "admin_login_failed"
    ADMIN_TOKEN_REFRESHED = "admin_token_refreshed"
    ADMIN_SESSION_REVOKED = "admin_session_revoked"
    ADMIN_SESSIONS_REVOKED_ALL = "admin_sessions_revoked_all"
    PERMISSION_DENIED = "permission_denied"
    PERMISSION_TEMPLATE_UPDATED = "permission_template_updated"
    PERMISSION_TEMPLATE_ROLLED_OUT = "permission_template_rolled_out"
    CLEANER_ONBOARDING_REVIEWED = "cleaner_onboarding_reviewed"
    MONITORING_ALERT_ACKNOWLEDGED = "monitoring_alert_acknowledged"
    MONITORING_ALERT_READ_STATE_CHANGED = "monitoring_alert_read_state_changed"
    ADMIN_CREATED = "admin_created"
    ADMIN_DELETED_SELF = "admin_deleted_self"
    CUSTOMER_READ = "customer_read"
    CLEANER_READ = "cleaner_read"
    AUDIT_EXPORT_REQUESTED = "audit_export_requested"


class AuditActor(BaseModel):
    id: str
    type: AuditActorType = AuditActorType.ADMIN
    display_name: str | None = None
    email: str | None = None


class AuditTarget(BaseModel):
    id: str
    type: str
    display_name: str | None = None


class AuditGeo(BaseModel):
    country: str | None = None
    city: str | None = None


class AuditPermission(BaseModel):
    key: str | None = None
    decision: str | None = None
    source: str | None = None


class AuditChange(BaseModel):
    field: str
    before: Any = None
    after: Any = None


class AuditRelated(BaseModel):
    alert_ids: list[str] | None = None
    session_id: str | None = None
    correlated_request_ids: list[str] | None = None


class AuditEvent(BaseModel):
    id: str
    timestamp: int
    date_created: int | None = None
    request_id: str | None = None
    trace_id: str | None = None
    span_id: str | None = None
    actor: AuditActor
    target: AuditTarget | None = None
    event_type: str
    action: str
    summary: str | None = None
    method: AuditHttpMethod | None = None
    endpoint: str | None = None
    resource: str | None = None
    status: AuditStatus
    http_status_code: int | None = None
    severity: AuditSeverity | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    geo: AuditGeo | None = None
    permission: AuditPermission | None = None
    payload_redacted: dict[str, Any] | None = None
    changes: list[AuditChange] | None = None
    related: AuditRelated | None = None
    tags: list[str] | None = None
    risk_score: int | None = None


class AuditHistoryPagination(BaseModel):
    start: int = 0
    stop: int = 20
    count: int
    total: int | None = None
    next_cursor: str | None = None
    has_more: bool


class AuditHistoryResponse(BaseModel):
    items: list[AuditEvent]
    pagination: AuditHistoryPagination
    query: dict[str, Any]


class AuditHistoryQuery(BaseModel):
    start: int = Field(default=0, ge=0)
    stop: int = Field(default=20, ge=0, le=200)
    cursor: str | None = None
    sort: AuditSort = AuditSort.DESC
    actor_id: str | None = None
    actor_type: AuditActorType | None = None
    target_id: str | None = None
    target_type: AuditTargetType | None = None
    endpoint: str | None = None
    method: AuditHttpMethod | None = None
    status: AuditStatus | None = None
    event_type: list[AuditEventType] | None = None
    request_id: str | None = None
    ip: str | None = None
    from_epoch: int | None = Field(default=None, ge=0)
    to_epoch: int | None = Field(default=None, ge=0)
    severity: AuditSeverity | None = None
    tags: list[str] | None = None
    include_payload: bool = False
    include_related: bool = False

    @model_validator(mode="after")
    def _validate_date_range(self):
        if self.from_epoch is not None and self.to_epoch is not None and self.from_epoch > self.to_epoch:
            raise ValueError("from_epoch must be <= to_epoch")
        if self.stop == 0:
            self.stop = self.start + 20
        if self.stop <= self.start:
            raise ValueError("Invalid pagination window: start must be smaller than stop")
        return self


class AuditExportOut(BaseModel):
    export_id: str
    status: str
    estimated_rows: int
    download_url: str | None = None
    expires_at: int


class AuditExportStatusOut(BaseModel):
    export_id: str
    status: str
    estimated_rows: int | None = None
    download_url: str | None = None
    expires_at: int | None = None
    error: str | None = None


class AuditListOut(AuditHistoryResponse):
    pass
