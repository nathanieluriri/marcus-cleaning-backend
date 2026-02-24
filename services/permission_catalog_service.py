from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from fastapi import status
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from core.errors import AppException, ErrorCode
from schemas.imports import Permission, PermissionList
from schemas.role_permission_template_schema import (
    PermissionCatalogGroup,
    PermissionCatalogOut,
    PermissionCatalogRouteItem,
)
from security.permissions import make_permission_key


def _strip_v1_prefix(path: str) -> str:
    if not path.startswith("/v1"):
        return path
    stripped = path[3:]
    return stripped if stripped.startswith("/") else f"/{stripped}"


def _resource_from_path(path: str) -> str:
    segments = [segment for segment in path.strip("/").split("/") if segment]
    if len(segments) < 2:
        return "unknown"
    return segments[1]


def _requires_auth(dependant: Dependant) -> bool:
    if dependant.security_requirements:
        return True
    return any(_requires_auth(child) for child in dependant.dependencies)


def _is_assignable_api_route(route: APIRoute) -> bool:
    path = route.path
    if not path.startswith("/v1/"):
        return False
    if path.startswith("/v1/admins"):
        return False
    return True


def build_permission_catalog_from_routes(routes: Iterable[object]) -> PermissionCatalogOut:
    items: list[PermissionCatalogRouteItem] = []
    seen_keys: set[str] = set()

    for route in routes:
        if not isinstance(route, APIRoute):
            continue
        if not _is_assignable_api_route(route):
            continue

        methods = sorted((route.methods or set()) - {"HEAD", "OPTIONS"})
        if not methods:
            continue

        resource = _resource_from_path(route.path)
        normalized_path = _strip_v1_prefix(route.path)
        endpoint_name = route.endpoint.__name__ if hasattr(route.endpoint, "__name__") else "unknown"
        requires_auth = _requires_auth(route.dependant)

        for method in methods:
            key = make_permission_key(method=method, path=normalized_path)
            if key in seen_keys:
                raise AppException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    code=ErrorCode.INTERNAL_ERROR,
                    message="Duplicate permission key detected while building permission catalog",
                    details={"key": key},
                )
            seen_keys.add(key)
            items.append(
                PermissionCatalogRouteItem(
                    resource=resource,
                    method=method,
                    path=route.path,
                    normalized_path=normalized_path,
                    key=key,
                    endpoint_name=endpoint_name,
                    summary=route.summary,
                    description=route.description,
                    requires_auth=requires_auth,
                )
            )

    sorted_items = sorted(items, key=lambda item: (item.resource, item.path, item.method))
    grouped_map: dict[str, list[PermissionCatalogRouteItem]] = defaultdict(list)
    flat_permissions: list[Permission] = []

    for item in sorted_items:
        grouped_map[item.resource].append(item)
        flat_permissions.append(
            Permission(
                name=item.endpoint_name,
                methods=[item.method],
                path=item.normalized_path,
                key=item.key,
                description=item.description,
            )
        )

    grouped = [
        PermissionCatalogGroup(resource=resource, routes=grouped_map[resource])
        for resource in sorted(grouped_map)
    ]
    return PermissionCatalogOut(grouped=grouped, flat=PermissionList(permissions=flat_permissions))

