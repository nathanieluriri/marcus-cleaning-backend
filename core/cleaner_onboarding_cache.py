from __future__ import annotations

import json
import time
from dataclasses import dataclass

from core.redis_cache import cache_db
from schemas.cleaner_schema import CleanerOut, get_cleaner_profile_missing_fields
from schemas.imports import OnboardingStatus
from security.principal import AuthPrincipal

CACHE_KEY_PREFIX = "cleaner:onboarding:token"
USER_TOKEN_INDEX_PREFIX = "cleaner:onboarding:user_tokens"
# Keep TTL aligned with repositories.tokens_repo.is_older_than_days(..., days=10).
ACCESS_TOKEN_MAX_AGE_SECONDS = 10 * 24 * 60 * 60

EXEMPT_PERMISSION_KEYS = frozenset(
    {
        "GET:/cleaners/me",
        "PUT:/cleaners/onboarding",
    }
)


@dataclass(frozen=True)
class CleanerOnboardingGateDecision:
    onboarding_status: OnboardingStatus
    rejection_reason: str | None
    missing_fields: list[str]

    @property
    def is_allowed(self) -> bool:
        return self.onboarding_status == OnboardingStatus.APPROVED and len(self.missing_fields) == 0


def should_enforce_cleaner_onboarding(permission_key: str) -> bool:
    if permission_key in EXEMPT_PERMISSION_KEYS:
        return False
    try:
        _method, path = permission_key.split(":", maxsplit=1)
    except ValueError:
        return False
    return path.startswith("/cleaners") or path.startswith("/bookings")


def build_onboarding_decision(cleaner: CleanerOut) -> CleanerOnboardingGateDecision:
    missing_fields = get_cleaner_profile_missing_fields(cleaner.profile)
    return CleanerOnboardingGateDecision(
        onboarding_status=cleaner.onboarding_status,
        rejection_reason=cleaner.rejection_reason,
        missing_fields=missing_fields,
    )


def _token_cache_key(access_token_id: str) -> str:
    return f"{CACHE_KEY_PREFIX}:{access_token_id}"


def _user_index_key(cleaner_id: str) -> str:
    return f"{USER_TOKEN_INDEX_PREFIX}:{cleaner_id}"


def _compute_ttl_seconds(principal: AuthPrincipal) -> int:
    created_at = principal.token_created_at
    if not created_at:
        return 300

    elapsed_seconds = max(int(time.time()) - int(created_at), 0)
    remaining_seconds = ACCESS_TOKEN_MAX_AGE_SECONDS - elapsed_seconds
    return max(remaining_seconds, 1)


def read_cached_onboarding_decision(access_token_id: str) -> CleanerOnboardingGateDecision | None:
    try:
        raw = cache_db.get(_token_cache_key(access_token_id))
    except Exception:
        return None

    if not raw:
        return None

    try:
        payload = json.loads(raw) # type: ignore
        return CleanerOnboardingGateDecision(
            onboarding_status=OnboardingStatus(str(payload.get("onboarding_status", "PENDING"))),
            rejection_reason=payload.get("rejection_reason"),
            missing_fields=[str(item) for item in payload.get("missing_fields", [])],
        )
    except Exception:
        return None


def write_cached_onboarding_decision(
    *,
    principal: AuthPrincipal,
    cleaner_id: str,
    decision: CleanerOnboardingGateDecision,
) -> None:
    ttl_seconds = _compute_ttl_seconds(principal)
    token_cache_key = _token_cache_key(principal.access_token_id)
    user_index_key = _user_index_key(cleaner_id)

    payload = {
        "onboarding_status": decision.onboarding_status.value,
        "rejection_reason": decision.rejection_reason,
        "missing_fields": decision.missing_fields,
    }

    try:
        cache_db.setex(token_cache_key, ttl_seconds, json.dumps(payload))
        cache_db.sadd(user_index_key, principal.access_token_id)
        cache_db.expire(user_index_key, ttl_seconds)
    except Exception:
        return


def invalidate_cleaner_onboarding_cache(cleaner_id: str) -> None:
    user_index_key = _user_index_key(cleaner_id)
    try:
        token_ids = cache_db.smembers(user_index_key) or set()
        if token_ids:
            cache_db.delete(*[_token_cache_key(token_id) for token_id in token_ids]) # type: ignore
        cache_db.delete(user_index_key)
    except Exception:
        return
