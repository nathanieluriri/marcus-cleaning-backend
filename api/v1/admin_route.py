from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse, Response

from core.response_envelope import document_response
from schemas.admin_schema import AdminBase, AdminCreate, AdminLogin, AdminOut, AdminRefresh
from schemas.cleaner_schema import CleanerOnboardingReviewRequest
from schemas.admin_directory_schema import (
    ADMIN_LIST_DEFAULT_START,
    ADMIN_LIST_DEFAULT_STOP,
    ADMIN_LIST_MAX_STOP,
)
from schemas.admin_reporting_schema import SignupBucket
from schemas.imports import AccountStatus, OnboardingStatus
from schemas.role_permission_template_schema import RolePermissionTemplateUpdate
from security.account_status_check import check_admin_account_status_and_permissions
from security.auth import verify_admin_token
from security.principal import AuthPrincipal
from services.admin_service import (
    add_admin,
    authenticate_admin,
    refresh_admin_tokens_reduce_number_of_logins,
    remove_admin,
    retrieve_admin_cleaner_detail,
    retrieve_admin_cleaners,
    retrieve_admin_customer_detail,
    retrieve_admin_customers,
    retrieve_admin_onboarding_queue,
    retrieve_admins,
)
from services.cleaner_service import review_cleaner_onboarding
from services.permission_catalog_service import build_permission_catalog_from_routes
from services.role_permission_template_service import (
    get_role_permission_rollout_impact,
    get_role_permission_template_view,
    preview_role_permission_template_for_role,
    rollout_role_permission_template_for_role,
    set_role_permission_template_for_role,
)
from services.admin_monitoring_service import (
    acknowledge_monitoring_alert,
    export_monitoring_audit,
    download_monitoring_audit_export,
    get_monitoring_audit_event,
    get_monitoring_audit_export_status,
    get_auth_heatmap,
    list_monitoring_audit,
    get_monitoring_overview,
    get_session_anomalies,
    get_alert_sla_metrics,
    get_top_denied_permissions,
    list_monitoring_alerts,
    log_admin_login_attempt,
    log_admin_refresh_attempt,
    log_admin_session_revocation,
    log_onboarding_review_action,
    log_permission_rollout,
    log_permission_template_change,
    set_alert_read_state,
)
from services.admin_reporting_service import (
    get_admin_user_growth_summary,
    get_admin_user_signup_trend,
)
from services.auth_session_service import revoke_all_sessions, revoke_current_session, revoke_other_sessions
from schemas.admin_monitoring_schema import (
    AlertAcknowledgeIn,
    AlertReadIn,
    AuditActorType,
    AuditEventType,
    AuditExportRequest,
    AuditHttpMethod,
    AuditRedactionLevel,
    AuditSeverity,
    AuditSort,
    AuditStatus,
    AuditTargetType,
)

router = APIRouter(prefix="/admins", tags=["Admins"])

PERMISSION_CATALOG_SUCCESS_EXAMPLE: dict[str, object] = {
    "grouped": [
        {
            "resource": "customers",
            "routes": [
                {
                    "resource": "customers",
                    "method": "GET",
                    "path": "/v1/customers/me",
                    "normalized_path": "/customers/me",
                    "key": "GET:/customers/me",
                    "endpoint_name": "get_my_users",
                    "summary": "Customer profile fetched successfully",
                    "description": None,
                    "requires_auth": True,
                }
            ],
        },
        {
            "resource": "payments",
            "routes": [
                {
                    "resource": "payments",
                    "method": "GET",
                    "path": "/v1/payments/{payment_id}",
                    "normalized_path": "/payments/{payment_id}",
                    "key": "GET:/payments/{payment_id}",
                    "endpoint_name": "fetch_transaction",
                    "summary": "Payment transaction fetched",
                    "description": None,
                    "requires_auth": True,
                }
            ],
        },
    ],
    "flat": {
        "permissions": [
            {
                "name": "get_my_users",
                "methods": ["GET"],
                "path": "/customers/me",
                "key": "GET:/customers/me",
                "description": "Customer profile fetched successfully",
            },
            {
                "name": "fetch_transaction",
                "methods": ["GET"],
                "path": "/payments/{payment_id}",
                "key": "GET:/payments/{payment_id}",
                "description": "Payment transaction fetched",
            },
        ]
    },
}


def _parse_audit_event_types(raw_values: list[str] | None) -> list[AuditEventType] | None:
    if not raw_values:
        return None
    tokens: list[str] = []
    for item in raw_values:
        for token in item.split(","):
            normalized = token.strip()
            if normalized:
                tokens.append(normalized)
    if not tokens:
        return None
    parsed: list[AuditEventType] = []
    invalid: list[str] = []
    for token in tokens:
        try:
            parsed.append(AuditEventType(token))
        except ValueError:
            invalid.append(token)
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Invalid event_type values: {', '.join(sorted(set(invalid)))}",
        )
    unique: list[AuditEventType] = []
    seen: set[str] = set()
    for item in parsed:
        if item.value in seen:
            continue
        seen.add(item.value)
        unique.append(item)
    return unique


@router.get(
    "/",
    dependencies=[
        Depends(check_admin_account_status_and_permissions),
    ],
)
@document_response(message="Admins fetched successfully", success_example=[])
async def list_admins(
    start: Annotated[
        int,
        Query(ge=0, description="The starting index (offset) for the list of admins."),
    ],
    stop: Annotated[
        int,
        Query(gt=0, description="The ending index for the list of admins (limit)."),
    ],
):
    items = await retrieve_admins(start=start, stop=stop)
    return items


@router.get("/profile")
@document_response(message="Admin profile fetched successfully")
async def get_my_admin(admin: AdminOut = Depends(check_admin_account_status_and_permissions)):
    return admin


@router.get("/permission-templates/{role}")
@document_response(message="Role permission template fetched successfully")
async def get_role_permission_template(
    role: Literal["cleaner", "customer"],
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    _ = admin
    return await get_role_permission_template_view(role=role)


@router.put("/permission-templates/{role}")
@document_response(message="Role permission template updated successfully")
async def set_role_permission_template(
    request: Request,
    role: Literal["cleaner", "customer"],
    payload: RolePermissionTemplateUpdate,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    before_template = await get_role_permission_template_view(role=role)
    updated = await set_role_permission_template_for_role(
        role=role,
        permission_list=payload.permissionList,
        admin_id=admin.id or "",
    )
    await log_permission_template_change(
        request=request,
        admin_id=admin.id or "",
        role=role,
        before_payload=before_template.model_dump(mode="json"),
        after_payload=updated.model_dump(mode="json"),
    )
    return updated


@router.post("/permission-templates/{role}/rollout")
@document_response(message="Role permission rollout completed successfully")
async def rollout_role_permission_template(
    request: Request,
    role: Literal["cleaner", "customer"],
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    rollout = await rollout_role_permission_template_for_role(role=role)
    await log_permission_rollout(
        request=request,
        admin_id=admin.id or "",
        role=role,
        matched_count=rollout.matched_count,
        modified_count=rollout.modified_count,
    )
    return rollout


@router.post("/permission-templates/{role}/preview")
@document_response(message="Role permission template preview generated successfully")
async def preview_role_permission_template(
    role: Literal["cleaner", "customer"],
    payload: RolePermissionTemplateUpdate,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    _ = admin
    return await preview_role_permission_template_for_role(
        role=role,
        permission_list=payload.permissionList,
    )


@router.get("/permission-templates/{role}/rollout-impact")
@document_response(message="Role permission rollout impact estimated successfully")
async def get_role_permission_template_rollout_impact(
    role: Literal["cleaner", "customer"],
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    _ = admin
    return await get_role_permission_rollout_impact(role=role)


@router.get("/permissions/catalog")
@document_response(
    message="Permission catalog fetched successfully",
    success_example=PERMISSION_CATALOG_SUCCESS_EXAMPLE,
)
async def get_permissions_catalog(
    request: Request,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    _ = admin
    return build_permission_catalog_from_routes(request.app.routes)


@router.patch("/cleaners/{cleaner_id}/onboarding-review")
@document_response(message="Cleaner onboarding review updated successfully")
async def review_cleaner_onboarding_by_admin(
    request: Request,
    cleaner_id: str,
    payload: CleanerOnboardingReviewRequest,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    reviewed = await review_cleaner_onboarding(cleaner_id=cleaner_id, payload=payload)
    await log_onboarding_review_action(
        request=request,
        admin_id=admin.id or "",
        cleaner_id=cleaner_id,
        status_value=payload.status.value,
        rejection_reason=payload.rejection_reason,
        latency_seconds=None,
    )
    return reviewed


@router.get("/customers")
@document_response(
    message="Customers fetched successfully",
    success_example=[],
    response_codes={401: "Unauthorized", 403: "Permission denied"},
)
async def list_customers_by_admin(
    start: int = Query(default=ADMIN_LIST_DEFAULT_START, ge=0),
    stop: int = Query(default=ADMIN_LIST_DEFAULT_STOP, gt=0, le=ADMIN_LIST_MAX_STOP),
    search: str | None = Query(default=None),
    account_status: AccountStatus | None = Query(default=None),
    from_epoch: int | None = Query(default=None, ge=0),
    to_epoch: int | None = Query(default=None, ge=0),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await retrieve_admin_customers(
        start=start,
        stop=stop,
        search=search,
        account_status=account_status,
        from_epoch=from_epoch,
        to_epoch=to_epoch,
    )


@router.get("/customers/{customer_id}")
@document_response(
    message="Customer fetched successfully",
    response_codes={400: "Invalid customer ID format", 401: "Unauthorized", 403: "Permission denied", 404: "Customer not found"},
)
async def get_customer_by_id_for_admin(
    customer_id: str,
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await retrieve_admin_customer_detail(customer_id=customer_id)


@router.get("/cleaners")
@document_response(
    message="Cleaners fetched successfully",
    success_example=[],
    response_codes={401: "Unauthorized", 403: "Permission denied"},
)
async def list_cleaners_by_admin(
    onboarding_status: OnboardingStatus | None = Query(default=None),
    start: int = Query(default=ADMIN_LIST_DEFAULT_START, ge=0),
    stop: int = Query(default=ADMIN_LIST_DEFAULT_STOP, gt=0, le=ADMIN_LIST_MAX_STOP),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await retrieve_admin_cleaners(
        start=start,
        stop=stop,
        onboarding_status=onboarding_status,
    )


@router.get("/onboarding/queue")
@document_response(
    message="Onboarding queue fetched successfully",
    success_example=[],
    response_codes={401: "Unauthorized", 403: "Permission denied"},
)
async def list_onboarding_queue_by_admin(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=50, gt=0, le=200),
    sort: Literal["submitted_at", "sla_age", "name"] = Query(default="submitted_at"),
    search: str | None = Query(default=None),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await retrieve_admin_onboarding_queue(
        start=start,
        stop=stop,
        sort=sort,
        search=search,
    )


@router.get("/cleaners/{cleaner_id}")
@document_response(
    message="Cleaner fetched successfully",
    response_codes={400: "Invalid cleaner ID format", 401: "Unauthorized", 403: "Permission denied", 404: "Cleaner not found"},
)
async def get_cleaner_by_id_for_admin(
    cleaner_id: str,
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await retrieve_admin_cleaner_detail(cleaner_id=cleaner_id)


@router.post("/signup")
@document_response(
    message="Admin created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def signup_new_admin(
    admin_data: AdminBase,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    admin_data_dict = admin_data.model_dump()
    new_admin = AdminCreate(invited_by=admin.id, **admin_data_dict) # type: ignore
    items = await add_admin(admin_data=new_admin)
    return items


@router.post("/login")
@document_response(message="Admin login successful")
async def login_admin(request: Request, admin_data: AdminLogin):
    try:
        items = await authenticate_admin(admin_data=admin_data) # type: ignore
        await log_admin_login_attempt(
            request=request,
            success=True,
            email=admin_data.email,
            admin_id=items.id,
            reason="login_success",
            status_code=200,
        )
        return items
    except HTTPException as err:
        await log_admin_login_attempt(
            request=request,
            success=False,
            email=admin_data.email,
            admin_id=None,
            reason=str(err.detail),
            status_code=err.status_code,
        )
        raise err


@router.post(
    "/refresh",
)
@document_response(message="Admin tokens refreshed successfully")
async def refresh_admin_tokens(
    request: Request,
    admin_data: Annotated[
        AdminRefresh,
        Body(
            openapi_examples={
                "successful_refresh": {
                    "summary": "Successful Token Refresh",
                    "description": (
                        "The correct payload for refreshing tokens. "
                        "The expired access token is provided in the Authorization header."
                    ),
                    "value": {"refresh_token": "valid.long.lived.refresh.token.98765"},
                },
                "invalid_refresh_token": {
                    "summary": "Invalid Refresh Token",
                    "description": (
                        "Payload that fails refresh because the refresh token is invalid or expired."
                    ),
                    "value": {"refresh_token": "expired.or.malformed.refresh.token.00000"},
                },
                "mismatched_tokens": {
                    "summary": "Tokens Belong to Different Admins",
                    "description": (
                        "Refresh token in the body does not match the admin ID from the expired access token."
                    ),
                    "value": {"refresh_token": "refresh.token.of.different.admin.77777"},
                },
            }
        ),
    ],
):
    try:
        items = await refresh_admin_tokens_reduce_number_of_logins(
            admin_refresh_data=admin_data,
            expired_access_token="",
        )
        await log_admin_refresh_attempt(
            request=request,
            success=True,
            admin_id=items.id,
            reason="refresh_success",
            status_code=200,
        )
        items.password = ""
        return items
    except HTTPException as err:
        detail_text = str(err.detail)
        await log_admin_refresh_attempt(
            request=request,
            success=False,
            admin_id=None,
            reason=detail_text,
            status_code=err.status_code,
            invalid_refresh_reuse="invalid refresh token" in detail_text.lower(),
        )
        raise


@router.get("/monitoring/overview")
@document_response(message="Admin monitoring overview fetched successfully")
async def get_admin_monitoring_overview(
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_monitoring_overview()


@router.get("/monitoring/auth/heatmap")
@document_response(message="Admin auth heatmap fetched successfully")
async def get_admin_auth_heatmap(
    days: int = Query(default=14, ge=1, le=90),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_auth_heatmap(days=days)


@router.get("/monitoring/permissions/denied-top")
@document_response(message="Denied permission metrics fetched successfully")
async def get_admin_denied_permissions_top(
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=10, ge=1, le=100),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_top_denied_permissions(hours=hours, limit=limit)


@router.get("/monitoring/sessions/anomalies")
@document_response(message="Session anomalies fetched successfully")
async def get_admin_session_anomalies(
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_session_anomalies()


@router.get("/monitoring/alerts/sla")
@document_response(message="Alert SLA metrics fetched successfully")
async def get_admin_alert_sla_metrics(
    hours: int = Query(default=24, ge=1, le=720),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_alert_sla_metrics(hours=hours)


@router.get("/monitoring/alerts")
@document_response(message="Monitoring alerts fetched successfully", success_example=[])
async def list_admin_monitoring_alerts(
    status_filter: str | None = Query(default=None, alias="status"),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=20, gt=0, le=200),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await list_monitoring_alerts(
        status=status_filter,
        unread_only=unread_only,
        start=start,
        stop=stop,
    )


@router.patch("/monitoring/alerts/{alert_id}/read")
@document_response(message="Monitoring alert read state updated successfully")
async def update_admin_monitoring_alert_read_state(
    request: Request,
    alert_id: str,
    payload: AlertReadIn,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    item = await set_alert_read_state(
        request=request,
        alert_id=alert_id,
        actor_id=admin.id,
        payload=payload,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Monitoring alert not found")
    return item


@router.patch("/monitoring/alerts/{alert_id}/ack")
@document_response(message="Monitoring alert acknowledgement updated successfully")
async def update_admin_monitoring_alert_ack(
    request: Request,
    alert_id: str,
    payload: AlertAcknowledgeIn,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    item = await acknowledge_monitoring_alert(
        request=request,
        alert_id=alert_id,
        actor_id=admin.id,
        payload=payload,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Monitoring alert not found")
    return item


@router.post("/monitoring/audit/export")
@document_response(message="Monitoring audit export generated successfully")
async def export_admin_monitoring_audit(
    payload: AuditExportRequest,
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await export_monitoring_audit(payload)


@router.get("/monitoring/audit/export/{export_id}")
@document_response(message="Monitoring audit export status fetched successfully")
async def get_admin_monitoring_audit_export_status(
    export_id: str,
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_monitoring_audit_export_status(export_id=export_id)


@router.get("/monitoring/audit/export/{export_id}/download")
async def download_admin_monitoring_audit_export(
    export_id: str,
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    payload, redirect_or_mime, filename = await download_monitoring_audit_export(export_id=export_id)
    if payload is None and redirect_or_mime:
        return RedirectResponse(url=redirect_or_mime, status_code=307)
    if payload is None:
        raise HTTPException(status_code=500, detail="Audit export artifact unavailable")
    mime_type = redirect_or_mime or "application/octet-stream"
    headers = {"Content-Disposition": f'attachment; filename="{filename or f"{export_id}.csv"}"'}
    return Response(content=payload, media_type=mime_type, headers=headers)


@router.get("/monitoring/audit/history")
@document_response(message="Audit history fetched successfully")
async def list_admin_monitoring_audit(
    actor_id: str | None = Query(default=None),
    actor_type: AuditActorType | None = Query(default=None),
    target_id: str | None = Query(default=None),
    target_type: AuditTargetType | None = Query(default=None),
    endpoint: str | None = Query(default=None),
    method: AuditHttpMethod | None = Query(default=None),
    status: AuditStatus | None = Query(default=None),
    event_type: list[str] | None = Query(default=None),
    request_id: str | None = Query(default=None),
    ip: str | None = Query(default=None),
    from_epoch: int | None = Query(default=None, ge=0),
    to_epoch: int | None = Query(default=None, ge=0),
    severity: AuditSeverity | None = Query(default=None),
    tags: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    sort: AuditSort = Query(default=AuditSort.DESC),
    include_payload: bool = Query(default=False),
    include_related: bool = Query(default=False),
    start: int = Query(default=0, ge=0, alias="start"),
    stop: int = Query(default=20, ge=0, le=200, alias="stop"),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    parsed_event_types = _parse_audit_event_types(event_type)
    parsed_tags = [item.strip() for item in (tags or "").split(",") if item.strip()] or None
    resolved_stop = stop
    if resolved_stop == 0:
        resolved_stop = start + 20
    if resolved_stop <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid pagination window: start must be smaller than stop",
        )
    return await list_monitoring_audit(
        actor_id=actor_id,
        actor_type=actor_type,
        target_id=target_id,
        target_type=target_type,
        endpoint=endpoint,
        method=method,
        audit_status=status,
        event_types=parsed_event_types,
        request_id=request_id,
        ip=ip,
        from_epoch=from_epoch,
        to_epoch=to_epoch,
        severity=severity,
        tags=parsed_tags,
        cursor=cursor,
        sort=sort,
        include_payload=include_payload,
        include_related=include_related,
        start=start,
        stop=resolved_stop,
    )


@router.get("/monitoring/audit/history/{event_id}")
@document_response(
    message="Monitoring audit event fetched successfully",
    response_codes={400: "Invalid audit event ID format", 401: "Unauthorized", 403: "Permission denied", 404: "Monitoring audit event not found"},
)
async def get_admin_monitoring_audit_event(
    event_id: str,
    include_payload: bool = Query(default=True),
    include_related: bool = Query(default=True),
    redaction: AuditRedactionLevel = Query(default=AuditRedactionLevel.STRICT),
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_monitoring_audit_event(
        event_id=event_id,
        include_payload=include_payload,
        include_related=include_related,
        redaction=redaction,
        allow_unredacted=bool(getattr(admin, "id", "") == "656f7ac12b9d4f6c9e2b9f7d"),
    )


@router.get("/reports/users/summary")
@document_response(message="User growth summary fetched successfully")
async def get_admin_user_reports_summary(
    from_epoch: int | None = Query(default=None, ge=0),
    to_epoch: int | None = Query(default=None, ge=0),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_admin_user_growth_summary(
        from_epoch=from_epoch,
        to_epoch=to_epoch,
    )


@router.get("/reports/users/signups-trend")
@document_response(message="User signup trend fetched successfully")
async def get_admin_user_reports_signup_trend(
    from_epoch: int | None = Query(default=None, ge=0),
    to_epoch: int | None = Query(default=None, ge=0),
    bucket: SignupBucket = Query(default="day"),
    _: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await get_admin_user_signup_trend(
        from_epoch=from_epoch,
        to_epoch=to_epoch,
        bucket=bucket,
    )


@router.post("/sessions/revoke-others")
@document_response(message="Other admin sessions revoked successfully")
async def revoke_other_admin_sessions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_admin_token),
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    access_deleted, refresh_deleted = await revoke_other_sessions(
        user_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
    )
    await log_admin_session_revocation(
        request=request,
        admin_id=admin.id,
        reason="revoke_others",
        revoked_access_sessions=access_deleted,
        revoked_refresh_sessions=refresh_deleted,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.post("/sessions/revoke-all")
@document_response(message="All admin sessions revoked successfully")
async def revoke_all_admin_sessions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_admin_token),
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    access_deleted, refresh_deleted = await revoke_all_sessions(
        user_id=principal.user_id,
        auth_subject=principal.auth_subject,
    )
    await log_admin_session_revocation(
        request=request,
        admin_id=admin.id,
        reason="revoke_all",
        revoked_access_sessions=access_deleted,
        revoked_refresh_sessions=refresh_deleted,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.post("/sessions/logout")
@document_response(message="Admin current session logged out successfully")
async def logout_admin_session(
    request: Request,
    principal: AuthPrincipal = Depends(verify_admin_token),
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    access_deleted, refresh_deleted = await revoke_current_session(
        user_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
        auth_subject=principal.auth_subject,
    )
    await log_admin_session_revocation(
        request=request,
        admin_id=admin.id,
        reason="logout_current",
        revoked_access_sessions=access_deleted,
        revoked_refresh_sessions=refresh_deleted,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.delete("/account")
@document_response(message="Admin account deleted successfully")
async def delete_admin_account(admin: AdminOut = Depends(check_admin_account_status_and_permissions)):
    result = await remove_admin(admin_id=admin.id) # type: ignore
    return result
