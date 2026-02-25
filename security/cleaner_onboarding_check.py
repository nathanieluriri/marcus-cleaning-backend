from __future__ import annotations

from fastapi import status

from core.cleaner_onboarding_cache import (
    build_onboarding_decision,
    read_cached_onboarding_decision,
    should_enforce_cleaner_onboarding,
    write_cached_onboarding_decision,
)
from core.errors import AppException, ErrorCode
from schemas.cleaner_schema import CleanerOut
from security.principal import AuthPrincipal
from services.cleaner_service import retrieve_user_by_user_id


def _raise_blocked(decision_status: str, rejection_reason: str | None, missing_fields: list[str]) -> None:
    raise AppException(
        status_code=status.HTTP_403_FORBIDDEN,
        code=ErrorCode.AUTH_PERMISSION_DENIED,
        message="Cleaner onboarding is not approved",
        details={
            "reason": "Complete onboarding and wait for admin approval before accessing this route.",
            "onboarding_status": decision_status,
            "rejection_reason": rejection_reason,
            "missing_fields": missing_fields,
        },
    )


async def enforce_cleaner_onboarding_gate(
    *,
    principal: AuthPrincipal,
    permission_key: str,
    cleaner: CleanerOut | None = None,
) -> CleanerOut | None:
    if principal.role != "cleaner":
        return cleaner

    if not should_enforce_cleaner_onboarding(permission_key):
        return cleaner

    cached = read_cached_onboarding_decision(principal.access_token_id)
    if cached is not None:
        if cached.is_allowed:
            return cleaner
        _raise_blocked(
            decision_status=cached.onboarding_status.value,
            rejection_reason=cached.rejection_reason,
            missing_fields=cached.missing_fields,
        )

    cleaner_account = cleaner or await retrieve_user_by_user_id(id=principal.user_id)
    decision = build_onboarding_decision(cleaner_account)
    write_cached_onboarding_decision(
        principal=principal,
        cleaner_id=cleaner_account.id or principal.user_id,
        decision=decision,
    )

    if decision.is_allowed:
        return cleaner_account

    _raise_blocked(
        decision_status=decision.onboarding_status.value,
        rejection_reason=decision.rejection_reason,
        missing_fields=decision.missing_fields,
    )
