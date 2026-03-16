from __future__ import annotations

import asyncio
import os
import sys

from security.auth0_client import password_login, refresh_access_token
from security.auth0_verifier import get_auth0_token_verifier


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


async def _run() -> int:
    try:
        email = _required("AUTH0_SMOKE_USER_EMAIL")
        password = _required("AUTH0_SMOKE_USER_PASSWORD")

        token_set = await password_login(email=email, password=password)
        claims = await get_auth0_token_verifier().verify_access_token(token_set.access_token)

        print(f"[PASS] password login issued valid token for sub={claims.sub}")

        if token_set.refresh_token:
            refreshed = await refresh_access_token(refresh_token=token_set.refresh_token)
            refreshed_claims = await get_auth0_token_verifier().verify_access_token(refreshed.access_token)
            print(f"[PASS] refresh flow issued valid token for sub={refreshed_claims.sub}")
        else:
            print("[WARN] no refresh_token returned; skipped refresh smoke")

        return 0
    except Exception as err:
        print(f"[FAIL] auth0 smoke failed: {err}", file=sys.stderr)
        return 1


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    raise SystemExit(main())
