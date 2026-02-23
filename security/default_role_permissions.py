from __future__ import annotations

from schemas.imports import Permission, PermissionList


SUPPORTED_NON_ADMIN_ROLES: tuple[str, ...] = ("cleaner", "customer")

_DEFAULT_ROLE_PERMISSIONS: dict[str, PermissionList] = {
    "cleaner": PermissionList(
        permissions=[
            Permission(
                name="cleaner_profile_read",
                methods=["GET"],
                path="/cleaners/me",
                key="GET:/cleaners/me",
                description="Read own cleaner profile",
            ),
            Permission(
                name="cleaner_account_delete",
                methods=["DELETE"],
                path="/cleaners/account",
                key="DELETE:/cleaners/account",
                description="Delete own cleaner account",
            ),
        ]
    ),
    "customer": PermissionList(
        permissions=[
            Permission(
                name="customer_profile_read",
                methods=["GET"],
                path="/customers/me",
                key="GET:/customers/me",
                description="Read own customer profile",
            ),
            Permission(
                name="customer_account_delete",
                methods=["DELETE"],
                path="/customers/account",
                key="DELETE:/customers/account",
                description="Delete own customer account",
            ),
        ]
    ),
}


def get_default_permission_list_for_role(role: str) -> PermissionList:
    normalized_role = (role or "").strip().lower()
    permission_list = _DEFAULT_ROLE_PERMISSIONS.get(normalized_role)
    if permission_list is None:
        raise ValueError(f"unsupported non-admin role: {role}")
    # Return a copy to keep defaults immutable at call sites.
    return PermissionList.model_validate(permission_list.model_dump(mode="json"))
