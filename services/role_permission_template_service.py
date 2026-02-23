from __future__ import annotations

from fastapi import status

from core.errors import AppException, ErrorCode
from repositories.role_permission_template_repo import (
    apply_permission_template_to_role_users,
    get_role_permission_template,
    upsert_role_permission_template,
)
from schemas.imports import PermissionList
from schemas.role_permission_template_schema import (
    RolePermissionRolloutOut,
    RolePermissionTemplateOut,
    RolePermissionTemplateView,
)
from security.default_role_permissions import (
    SUPPORTED_NON_ADMIN_ROLES,
    get_default_permission_list_for_role,
)


def _normalize_non_admin_role(role: str) -> str:
    normalized_role = (role or "").strip().lower()
    if normalized_role not in SUPPORTED_NON_ADMIN_ROLES:
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.VALIDATION_FAILED,
            message="Unsupported role for permission template",
            details={"role": role, "supported_roles": list(SUPPORTED_NON_ADMIN_ROLES)},
        )
    return normalized_role


async def get_effective_permission_list_for_role(role: str) -> PermissionList:
    normalized_role = _normalize_non_admin_role(role)
    template = await get_role_permission_template(normalized_role)
    if template is not None:
        return PermissionList.model_validate(template.permissionList.model_dump(mode="json"))
    return get_default_permission_list_for_role(normalized_role)


async def get_role_permission_template_view(role: str) -> RolePermissionTemplateView:
    normalized_role = _normalize_non_admin_role(role)
    template = await get_role_permission_template(normalized_role)
    if template is not None:
        return RolePermissionTemplateView(
            role=template.role,
            permissionList=template.permissionList,
            source="template",
            updated_by=template.updated_by,
            date_created=template.date_created,
            last_updated=template.last_updated,
        )

    return RolePermissionTemplateView(
        role=normalized_role,  # type: ignore[arg-type]
        permissionList=get_default_permission_list_for_role(normalized_role),
        source="default",
    )


async def set_role_permission_template_for_role(
    *,
    role: str,
    permission_list: PermissionList,
    admin_id: str,
) -> RolePermissionTemplateOut:
    normalized_role = _normalize_non_admin_role(role)
    if not admin_id:
        raise AppException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.VALIDATION_FAILED,
            message="Admin identifier is required to update role permission templates",
        )
    return await upsert_role_permission_template(
        role=normalized_role,
        permission_list=permission_list,
        updated_by=admin_id,
    )


async def rollout_role_permission_template_for_role(role: str) -> RolePermissionRolloutOut:
    normalized_role = _normalize_non_admin_role(role)
    template = await get_role_permission_template(normalized_role)
    source = "template"
    permission_list = template.permissionList if template is not None else get_default_permission_list_for_role(normalized_role)
    if template is None:
        source = "default"

    matched_count, modified_count = await apply_permission_template_to_role_users(
        role=normalized_role,
        permission_list=permission_list,
    )
    return RolePermissionRolloutOut(
        role=normalized_role,  # type: ignore[arg-type]
        source=source,  # type: ignore[arg-type]
        matched_count=matched_count,
        modified_count=modified_count,
    )
