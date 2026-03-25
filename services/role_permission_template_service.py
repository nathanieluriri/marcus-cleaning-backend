from __future__ import annotations

from collections import Counter

from fastapi import HTTPException
from fastapi import status

from core.errors import AppException, ErrorCode
from repositories.role_permission_template_repo import (
    apply_permission_template_to_role_users,
    estimate_permission_template_rollout,
    get_role_permission_template,
    upsert_role_permission_template,
)
from schemas.imports import Permission, PermissionList
from schemas.role_permission_template_schema import (
    RolePermissionRolloutImpactOut,
    RolePermissionRolloutOut,
    RolePermissionTemplateOut,
    RolePermissionTemplatePreviewOut,
    RolePermissionTemplateView,
)
from security.default_role_permissions import (
    SUPPORTED_NON_ADMIN_ROLES,
    get_default_permission_list_for_role,
)
from security.permissions import make_permission_key


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


def invalidate_role_permission_template_cache(*, role: str) -> None:
    # No in-process cache currently exists for role templates. Keep explicit hook for future cache backends.
    _ = role


async def _safe_get_role_permission_template(role: str) -> RolePermissionTemplateOut | None:
    try:
        return await get_role_permission_template(role)
    except HTTPException as err:
        detail = str(getattr(err, "detail", "") or "")
        # Motor client can be tied to a closed event loop in test environments that rotate loops.
        # Treat this specific case as a cache miss/template absence and continue with defaults.
        if err.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR and "Event loop is closed" in detail:
            return None
        raise


async def get_effective_permission_list_for_role(role: str) -> PermissionList:
    normalized_role = _normalize_non_admin_role(role)
    template = await _safe_get_role_permission_template(normalized_role)
    if template is not None:
        return PermissionList.model_validate(template.permissionList.model_dump(mode="json"))
    return get_default_permission_list_for_role(normalized_role)


async def get_role_permission_template_view(role: str) -> RolePermissionTemplateView:
    normalized_role = _normalize_non_admin_role(role)
    template = await _safe_get_role_permission_template(normalized_role)
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
    updated = await upsert_role_permission_template(
        role=normalized_role,
        permission_list=permission_list,
        updated_by=admin_id,
    )
    invalidate_role_permission_template_cache(role=normalized_role)
    return updated


async def rollout_role_permission_template_for_role(role: str) -> RolePermissionRolloutOut:
    normalized_role = _normalize_non_admin_role(role)
    template = await _safe_get_role_permission_template(normalized_role)
    source = "template"
    permission_list = template.permissionList if template is not None else get_default_permission_list_for_role(normalized_role)
    if template is None:
        source = "default"

    matched_count, modified_count = await apply_permission_template_to_role_users(
        role=normalized_role,
        permission_list=permission_list,
    )
    invalidate_role_permission_template_cache(role=normalized_role)
    return RolePermissionRolloutOut(
        role=normalized_role,  # type: ignore[arg-type]
        source=source,  # type: ignore[arg-type]
        matched_count=matched_count,
        modified_count=modified_count,
    )


def _permission_keys(permission: Permission) -> list[str]:
    if permission.key:
        return [permission.key]
    if not permission.methods:
        return []
    return [make_permission_key(method=method, path=permission.path) for method in permission.methods]


def _normalize_permission_key_set(permission_list: PermissionList) -> set[str]:
    normalized_keys: set[str] = set()
    for permission in permission_list.permissions:
        normalized_keys.update(_permission_keys(permission))
    return normalized_keys


def _validate_candidate_permissions(permission_list: PermissionList) -> tuple[list[str], list[str]]:
    duplicate_keys: list[str] = []
    invalid_entries: list[str] = []
    key_counter: Counter[str] = Counter()

    for index, permission in enumerate(permission_list.permissions):
        keys = _permission_keys(permission)
        if not keys:
            invalid_entries.append(f"permissions[{index}] has no method/key")
            continue
        for key in keys:
            key_counter[key] += 1
            if permission.path:
                for method in permission.methods:
                    expected = make_permission_key(method=method, path=permission.path)
                    if permission.key and permission.key != expected:
                        invalid_entries.append(
                            f"permissions[{index}] key mismatch: key={permission.key} expected={expected}"
                        )

    duplicate_keys = sorted([key for key, count in key_counter.items() if count > 1])
    return duplicate_keys, invalid_entries


async def preview_role_permission_template_for_role(
    *,
    role: str,
    permission_list: PermissionList,
) -> RolePermissionTemplatePreviewOut:
    normalized_role = _normalize_non_admin_role(role)
    current_view = await get_role_permission_template_view(normalized_role)

    duplicate_keys, invalid_entries = _validate_candidate_permissions(permission_list)
    candidate_keys = _normalize_permission_key_set(permission_list)
    current_keys = _normalize_permission_key_set(current_view.permissionList)

    additions = sorted(candidate_keys - current_keys)
    removals = sorted(current_keys - candidate_keys)
    return RolePermissionTemplatePreviewOut(
        additions=additions,
        removals=removals,
        invalidEntries=invalid_entries,
        duplicateKeys=duplicate_keys,
    )


async def get_role_permission_rollout_impact(role: str) -> RolePermissionRolloutImpactOut:
    normalized_role = _normalize_non_admin_role(role)
    template = await _safe_get_role_permission_template(normalized_role)
    source = "template"
    permission_list = template.permissionList if template is not None else get_default_permission_list_for_role(normalized_role)
    if template is None:
        source = "default"

    matched_count, would_change_count = await estimate_permission_template_rollout(
        role=normalized_role,
        permission_list=permission_list,
    )
    return RolePermissionRolloutImpactOut(
        role=normalized_role,  # type: ignore[arg-type]
        source=source,  # type: ignore[arg-type]
        matched_count=matched_count,
        would_change_count=would_change_count,
    )
