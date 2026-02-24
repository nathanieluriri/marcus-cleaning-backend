from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Query, Request, status

from core.response_envelope import document_response
from schemas.admin_schema import AdminBase, AdminCreate, AdminLogin, AdminOut, AdminRefresh
from schemas.role_permission_template_schema import RolePermissionTemplateUpdate
from security.account_status_check import check_admin_account_status_and_permissions
from security.auth import verify_admin_refresh_token
from security.principal import AuthPrincipal
from services.admin_service import (
    add_admin,
    authenticate_admin,
    refresh_admin_tokens_reduce_number_of_logins,
    remove_admin,
    retrieve_admins,
)
from services.permission_catalog_service import build_permission_catalog_from_routes
from services.role_permission_template_service import (
    get_role_permission_template_view,
    rollout_role_permission_template_for_role,
    set_role_permission_template_for_role,
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
                    "method": "POST",
                    "path": "/v1/payments/intents",
                    "normalized_path": "/payments/intents",
                    "key": "POST:/payments/intents",
                    "endpoint_name": "create_intent",
                    "summary": "Payment intent created",
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
                "name": "create_intent",
                "methods": ["POST"],
                "path": "/payments/intents",
                "key": "POST:/payments/intents",
                "description": "Payment intent created",
            },
        ]
    },
}


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
    role: Literal["cleaner", "customer"],
    payload: RolePermissionTemplateUpdate,
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    return await set_role_permission_template_for_role(
        role=role,
        permission_list=payload.permissionList,
        admin_id=admin.id or "",
    )


@router.post("/permission-templates/{role}/rollout")
@document_response(message="Role permission rollout completed successfully")
async def rollout_role_permission_template(
    role: Literal["cleaner", "customer"],
    admin: AdminOut = Depends(check_admin_account_status_and_permissions),
):
    _ = admin
    return await rollout_role_permission_template_for_role(role=role)


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
async def login_admin(admin_data: AdminLogin):
    items = await authenticate_admin(admin_data=admin_data) # type: ignore
    return items


@router.post(
    "/refresh",
)
@document_response(message="Admin tokens refreshed successfully")
async def refresh_admin_tokens(
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
    principal: AuthPrincipal = Depends(verify_admin_refresh_token),
):
    items = await refresh_admin_tokens_reduce_number_of_logins(
        admin_refresh_data=admin_data,
        expired_access_token=principal.access_token_id,
    )

    items.password = ""
    return items


@router.delete("/account")
@document_response(message="Admin account deleted successfully")
async def delete_admin_account(admin: AdminOut = Depends(check_admin_account_status_and_permissions)):
    result = await remove_admin(admin_id=admin.id) # type: ignore
    return result
