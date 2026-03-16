from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class CheckResult:
    key: str
    ok: bool
    expected: Any
    actual: Any


def _env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _load_baseline() -> dict[str, Any]:
    baseline_env = os.getenv("AUTH0_BASELINE_ENV", "").strip().lower()
    if baseline_env:
        path = f"security/auth0_baselines/{baseline_env}.json"
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)

    raw = os.getenv("AUTH0_BASELINE_JSON", "").strip()
    if raw:
        return json.loads(raw)

    path = os.getenv("AUTH0_BASELINE_FILE", "").strip()
    if path:
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)

    raise RuntimeError("Provide AUTH0_BASELINE_ENV, AUTH0_BASELINE_JSON, or AUTH0_BASELINE_FILE")


def _management_token(*, domain: str, client_id: str, client_secret: str) -> str:
    url = f"https://{domain}/oauth/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "audience": f"https://{domain}/api/v2/",
    }
    response = requests.post(url, json=payload, timeout=10)
    response.raise_for_status()
    body = response.json()
    token = str(body.get("access_token") or "").strip()
    if not token:
        raise RuntimeError("Auth0 management token response missing access_token")
    return token


def _get_json(*, url: str, token: str) -> Any:
    response = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=10)
    response.raise_for_status()
    return response.json()


def _select(data: Any, dotted_key: str) -> Any:
    cursor: Any = data
    for part in dotted_key.split("."):
        if isinstance(cursor, dict) and part in cursor:
            cursor = cursor[part]
            continue
        return None
    return cursor


def _check_equals(*, source: dict[str, Any], expected_map: dict[str, Any], prefix: str) -> list[CheckResult]:
    results: list[CheckResult] = []
    for key, expected in expected_map.items():
        actual = _select(source, key)
        results.append(CheckResult(key=f"{prefix}:{key}", ok=actual == expected, expected=expected, actual=actual))
    return results


def _normalize_url_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted(str(item).strip() for item in value if str(item).strip())


def main() -> int:
    try:
        domain = _env("AUTH0_DOMAIN")
        mgmt_client_id = _env("AUTH0_MGMT_CLIENT_ID")
        mgmt_client_secret = _env("AUTH0_MGMT_CLIENT_SECRET")
        baseline = _load_baseline()

        token = _management_token(
            domain=domain,
            client_id=mgmt_client_id,
            client_secret=mgmt_client_secret,
        )

        tenant_settings = _get_json(url=f"https://{domain}/api/v2/tenants/settings", token=token)
        brute_force = _get_json(url=f"https://{domain}/api/v2/attack-protection/brute-force-protection", token=token)
        suspicious_ip = _get_json(url=f"https://{domain}/api/v2/attack-protection/suspicious-ip-throttling", token=token)
        breached_password = _get_json(url=f"https://{domain}/api/v2/attack-protection/breached-password-detection", token=token)
        guardian_factors = _get_json(url=f"https://{domain}/api/v2/guardian/factors", token=token)

        checks: list[CheckResult] = []
        checks.extend(
            _check_equals(
                source=tenant_settings,
                expected_map=baseline.get("tenant_settings", {}),
                prefix="tenant_settings",
            )
        )
        checks.extend(
            _check_equals(
                source=brute_force,
                expected_map=baseline.get("brute_force", {}),
                prefix="brute_force",
            )
        )
        checks.extend(
            _check_equals(
                source=suspicious_ip,
                expected_map=baseline.get("suspicious_ip_throttling", {}),
                prefix="suspicious_ip_throttling",
            )
        )
        checks.extend(
            _check_equals(
                source=breached_password,
                expected_map=baseline.get("breached_password", {}),
                prefix="breached_password",
            )
        )

        expected_guardian_enabled = baseline.get("guardian_enabled_factors", [])
        if isinstance(expected_guardian_enabled, list):
            enabled_names = sorted(
                str(item.get("name"))
                for item in guardian_factors
                if isinstance(item, dict) and item.get("enabled") is True and item.get("name")
            )
            expected_names = sorted(str(item) for item in expected_guardian_enabled)
            checks.append(
                CheckResult(
                    key="guardian_enabled_factors",
                    ok=enabled_names == expected_names,
                    expected=expected_names,
                    actual=enabled_names,
                )
            )

        expected_callbacks = baseline.get("client_callbacks")
        expected_logout_urls = baseline.get("client_allowed_logout_urls")
        if expected_callbacks is not None or expected_logout_urls is not None:
            client_id = _env("AUTH0_CLIENT_ID")
            client = _get_json(url=f"https://{domain}/api/v2/clients/{client_id}", token=token)
            if expected_callbacks is not None:
                actual_callbacks = _normalize_url_list(client.get("callbacks"))
                checks.append(
                    CheckResult(
                        key="client_callbacks",
                        ok=actual_callbacks == _normalize_url_list(expected_callbacks),
                        expected=_normalize_url_list(expected_callbacks),
                        actual=actual_callbacks,
                    )
                )
            if expected_logout_urls is not None:
                actual_logout_urls = _normalize_url_list(client.get("allowed_logout_urls"))
                checks.append(
                    CheckResult(
                        key="client_allowed_logout_urls",
                        ok=actual_logout_urls == _normalize_url_list(expected_logout_urls),
                        expected=_normalize_url_list(expected_logout_urls),
                        actual=actual_logout_urls,
                    )
                )

        failing = [item for item in checks if not item.ok]
        for item in checks:
            status = "PASS" if item.ok else "FAIL"
            print(f"[{status}] {item.key} expected={item.expected!r} actual={item.actual!r}")

        if failing:
            print(f"\nAuth0 baseline drift detected: {len(failing)} failing checks", file=sys.stderr)
            return 1

        print("\nAuth0 baseline checks passed")
        return 0
    except Exception as err:
        print(f"Auth0 baseline check failed: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
