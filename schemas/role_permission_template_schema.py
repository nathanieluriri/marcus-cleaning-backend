from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from schemas.imports import PermissionList


RoleTemplateRole = Literal["cleaner", "customer"]


class RolePermissionTemplateUpdate(BaseModel):
    permissionList: PermissionList


class RolePermissionTemplateOut(BaseModel):
    role: RoleTemplateRole
    permissionList: PermissionList
    updated_by: str
    date_created: int
    last_updated: int


class RolePermissionTemplateView(BaseModel):
    role: RoleTemplateRole
    permissionList: PermissionList
    source: Literal["template", "default"]
    updated_by: str | None = None
    date_created: int | None = None
    last_updated: int | None = None


class RolePermissionRolloutOut(BaseModel):
    role: RoleTemplateRole
    source: Literal["template", "default"]
    matched_count: int
    modified_count: int
