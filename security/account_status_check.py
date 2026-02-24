from __future__ import annotations

import os
from importlib import import_module
from typing import Final

from fastapi import Depends, Request, status

from core.errors import AppException, ErrorCode, auth_permission_denied, auth_role_mismatch
from schemas.imports import AccountStatus, PermissionList
from security.auth import verify_admin_token, verify_any_token, verify_cleaner_token, verify_customer_token
from security.permissions import make_permission_key
from security.principal import AuthPrincipal
from services.admin_service import retrieve_admin_by_admin_id

SUPER_ADMIN_STATIC_ID: Final[str] = "656f7ac12b9d4f6c9e2b9f7d"
SUPER_ADMIN_EMAIL: Final[str] = (os.getenv("SUPER_ADMIN_EMAIL") or "").strip().lower()


def _is_super_admin_account(*, admin_id: str | None, admin_email: str | None) -> bool:
    normalized_id = (admin_id or "").strip()
    normalized_email = (admin_email or "").strip().lower()

    if normalized_id and normalized_id == SUPER_ADMIN_STATIC_ID:
        return True
    if SUPER_ADMIN_EMAIL and normalized_email and normalized_email == SUPER_ADMIN_EMAIL:
        return True
    return False


def _validate_permission_list(permission_list: PermissionList | None) -> None:
    if permission_list is None or not permission_list.permissions:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_PERMISSION_DENIED,
            message="No permissions assigned",
        )

    seen: set[str] = set()
    for permission in permission_list.permissions:
        if permission.key:
            if permission.key in seen:
                raise AppException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    code=ErrorCode.INTERNAL_ERROR,
                    message="Duplicate permission key configuration",
                    details={"key": permission.key},
                )
            seen.add(permission.key)


def _has_permission(
    *,
    permission_list: PermissionList,
    permission_key: str,
    endpoint_name: str,
    request_method: str,
) -> bool:
    for permission in permission_list.permissions:
        if permission.key and permission.key == permission_key:
            return True

        if permission.name == endpoint_name and request_method in permission.methods:
            return True

    return False


def _build_permission_context(request: Request) -> tuple[str, str, str]:
    endpoint = request.scope.get("endpoint")
    endpoint_name = endpoint.__name__ if endpoint else "unknown"
    request_method = request.method.upper()
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    # Remove API version prefix
    if route_path.startswith("/v1"):
        route_path = route_path[3:]
    
    permission_key = make_permission_key(method=request_method, path=route_path)
    return endpoint_name, request_method, permission_key


async def _check_non_admin_account_status_and_permissions(
    *,
    request: Request,
    principal: AuthPrincipal,
    role: str,
):
   
    module = import_module(f"services.{role}_service")
    fetcher = getattr(module, f"retrieve_user_by_user_id", None)
    if fetcher is None:
        raise AppException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            message="Missing role retrieval function",
            details={"role": role},
        )

    account = await fetcher(id=principal.user_id)
    if not account:
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=ErrorCode.AUTH_PRINCIPAL_NOT_FOUND,
            message=f"{role.capitalize()} not found",
        )

    if account.accountStatus != AccountStatus.ACTIVE:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_ACCOUNT_INACTIVE,
            message=f"{role.capitalize()} account is not active",
        )

    endpoint_name, request_method, permission_key = _build_permission_context(request)
    permission_list = getattr(account, "permissionList", None)
    _validate_permission_list(permission_list)

    if not _has_permission(
        permission_list=permission_list, # type: ignore
        permission_key=permission_key,
        endpoint_name=endpoint_name,
        request_method=request_method,
    ):
        raise auth_permission_denied(permission_key)

    return account


async def check_admin_account_status_and_permissions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_admin_token),
):
    admin = await retrieve_admin_by_admin_id(id=principal.user_id)
    if not admin:
        raise AppException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=ErrorCode.AUTH_PRINCIPAL_NOT_FOUND,
            message="Admin not found",
        )

    if admin.accountStatus != AccountStatus.ACTIVE:
        raise AppException(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.AUTH_ACCOUNT_INACTIVE,
            message="Admin account is not active",
        )

    if _is_super_admin_account(
        admin_id=getattr(admin, "id", None),
        admin_email=getattr(admin, "email", None),
    ):
        return admin

    endpoint_name, request_method, permission_key = _build_permission_context(request)
    permission_list = getattr(admin, "permissionList", None)
    _validate_permission_list(permission_list)

    if not _has_permission(
        permission_list=permission_list, # type: ignore
        permission_key=permission_key,
        endpoint_name=endpoint_name,
        request_method=request_method,
    ):
        raise auth_permission_denied(permission_key)

    return admin


async def check_cleaner_account_status_and_permissions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    return await _check_non_admin_account_status_and_permissions(
        request=request,
        principal=principal,
        role="cleaner",
    )


async def check_user_account_status_and_permissions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_any_token),
):
    if principal.role == "cleaner":
        return await _check_non_admin_account_status_and_permissions(
            request=request,
            principal=principal,
            role="cleaner",
        )
    if principal.role == "customer":
        return await _check_non_admin_account_status_and_permissions(
            request=request,
            principal=principal,
            role="customer",
        )
    raise auth_role_mismatch(required_role="cleaner|customer", actual_role=principal.role)


async def check_customer_account_status_and_permissions(
    request: Request,
    principal: AuthPrincipal = Depends(verify_customer_token),
):
    return await _check_non_admin_account_status_and_permissions(
        request=request,
        principal=principal,
        role="customer",
    )
