from __future__ import annotations

from fastapi import Depends, Path

from schemas.booking import BookingOut
from security.auth import verify_any_token, verify_cleaner_token, verify_customer_token
from security.principal import AuthPrincipal
from services.booking_service import retrieve_booking_for_principal


async def require_customer_principal(
    principal: AuthPrincipal = Depends(verify_customer_token),
) -> AuthPrincipal:
    return principal


async def require_cleaner_principal(
    principal: AuthPrincipal = Depends(verify_cleaner_token),
) -> AuthPrincipal:
    return principal


async def require_booking_visibility(
    booking_id: str = Path(..., description="Booking identifier"),
    principal: AuthPrincipal = Depends(verify_any_token),
) -> BookingOut:
    return await retrieve_booking_for_principal(booking_id=booking_id, principal=principal)
