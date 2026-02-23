from __future__ import annotations

import time
from typing import Any

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from core.database import db
from schemas.imports import PermissionList
from schemas.role_permission_template_schema import RolePermissionTemplateOut


def _get_collection_for_role(role: str):
    normalized_role = (role or "").strip().lower()
    if normalized_role == "cleaner":
        return db.cleaners
    if normalized_role == "customer":
        return db.customers
    raise ValueError(f"unsupported non-admin role: {role}")


async def get_role_permission_template(role: str) -> RolePermissionTemplateOut | None:
    try:
        result = await db.role_permission_templates.find_one({"role": role})
        if result is None:
            return None
        return RolePermissionTemplateOut(**result)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch role permission template: {err}",
        ) from err


async def upsert_role_permission_template(
    *,
    role: str,
    permission_list: PermissionList,
    updated_by: str,
) -> RolePermissionTemplateOut:
    now = int(time.time())
    try:
        result = await db.role_permission_templates.find_one_and_update(
            {"role": role},
            {
                "$set": {
                    "permissionList": permission_list.model_dump(mode="json"),
                    "updated_by": updated_by,
                    "last_updated": now,
                },
                "$setOnInsert": {
                    "role": role,
                    "date_created": now,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if result is None:
            raise RuntimeError("template upsert returned no document")
        return RolePermissionTemplateOut(**result)
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save role permission template: {err}",
        ) from err


async def apply_permission_template_to_role_users(
    *,
    role: str,
    permission_list: PermissionList,
) -> tuple[int, int]:
    collection = _get_collection_for_role(role)
    now = int(time.time())
    permission_payload: dict[str, Any] = permission_list.model_dump(mode="json")

    try:
        result = await collection.update_many(
            {},
            {
                "$set": {
                    "permissionList": permission_payload,
                    "last_updated": now,
                }
            },
        )
        return result.matched_count, result.modified_count
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to apply role permissions to users: {err}",
        ) from err
