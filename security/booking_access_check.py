from __future__ import annotations

from fastapi import Depends, Path, Request

from schemas.booking import BookingOut
from security.auth import verify_any_token, verify_cleaner_token, verify_customer_token
from security.cleaner_onboarding_check import enforce_cleaner_onboarding_gate
from security.permissions import make_permission_key
from security.principal import AuthPrincipal
from services.booking_service import retrieve_booking_for_principal


def build_permission_key_from_request(request: Request) -> str:
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    if route_path.startswith("/v1"):
        route_path = route_path[3:]
    return make_permission_key(method=request.method.upper(), path=route_path)


async def require_customer_principal(
    principal: AuthPrincipal = Depends(verify_customer_token),
) -> AuthPrincipal:
    return principal


async def require_cleaner_principal(
    request: Request,
    principal: AuthPrincipal = Depends(verify_cleaner_token),
) -> AuthPrincipal:
    await enforce_cleaner_onboarding_gate(
        principal=principal,
        permission_key=build_permission_key_from_request(request),
    )
    return principal


async def require_booking_principal(
    request: Request,
    principal: AuthPrincipal = Depends(verify_any_token),
) -> AuthPrincipal:
    await enforce_cleaner_onboarding_gate(
        principal=principal,
        permission_key=build_permission_key_from_request(request),
    )
    return principal


async def require_booking_visibility(
    request: Request,
    booking_id: str = Path(..., description="Booking identifier"),
    principal: AuthPrincipal = Depends(require_booking_principal),
) -> BookingOut:
    _ = request
    return await retrieve_booking_for_principal(booking_id=booking_id, principal=principal)
