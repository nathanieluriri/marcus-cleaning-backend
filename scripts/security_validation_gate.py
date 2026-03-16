from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass
class CheckResult:
    name: str
    ok: bool
    details: str


def _run(cmd: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


def _file_contains(path: Path, pattern: str) -> bool:
    if not path.exists():
        return False
    return re.search(pattern, path.read_text(encoding="utf-8"), flags=re.MULTILINE) is not None


def check_legacy_modules_removed() -> CheckResult:
    targets = [ROOT / "security/tokens.py", ROOT / "services/auth_helpers.py"]
    missing = [str(path.relative_to(ROOT)) for path in targets if not path.exists()]
    ok = len(missing) == len(targets)
    detail = f"missing={missing}" if ok else "legacy modules still present"
    return CheckResult(name="legacy_modules_removed", ok=ok, details=detail)


def check_no_legacy_imports() -> CheckResult:
    cmd = [
        "rg",
        "-n",
        "from security\\.tokens|import security\\.tokens|from services\\.auth_helpers|import services\\.auth_helpers",
        "api",
        "core",
        "repositories",
        "schemas",
        "security",
        "services",
    ]
    code, out, err = _run(cmd)
    if code == 1:
        return CheckResult(name="no_legacy_imports", ok=True, details="no references found")
    if code == 0:
        return CheckResult(name="no_legacy_imports", ok=False, details=out.strip())
    return CheckResult(name="no_legacy_imports", ok=False, details=err.strip() or "rg failed")


def check_auth0_claim_requirement() -> CheckResult:
    verifier = ROOT / "security/auth0_verifier.py"
    ok = _file_contains(verifier, r'"require"\s*:\s*\["sub",\s*"exp",\s*"iat",\s*"nbf"\]')
    return CheckResult(
        name="auth0_requires_nbf",
        ok=ok,
        details="nbf required in verifier" if ok else "nbf requirement missing",
    )


def check_session_endpoints_present() -> CheckResult:
    files = [
        ROOT / "api/v1/customer_route.py",
        ROOT / "api/v1/cleaner_route.py",
        ROOT / "api/v1/admin_route.py",
    ]
    patterns = [
        r"/sessions/revoke-others",
        r"/sessions/revoke-all",
        r"/sessions/logout",
    ]
    missing: list[str] = []
    for file_path in files:
        content = file_path.read_text(encoding="utf-8")
        for pattern in patterns:
            if re.search(pattern, content) is None:
                missing.append(f"{file_path.relative_to(ROOT)}:{pattern}")
    return CheckResult(
        name="session_endpoints_present",
        ok=not missing,
        details="all role endpoints present" if not missing else "; ".join(missing),
    )


def check_auth0_ci_workflows_present() -> CheckResult:
    targets = [
        ROOT / ".github/workflows/auth0-tenant-baseline.yml",
        ROOT / ".github/workflows/auth0-smoke.yml",
    ]
    missing = [str(path.relative_to(ROOT)) for path in targets if not path.exists()]
    return CheckResult(
        name="auth0_ci_workflows_present",
        ok=not missing,
        details="all present" if not missing else f"missing={missing}",
    )


def main() -> int:
    checks = [
        check_legacy_modules_removed(),
        check_no_legacy_imports(),
        check_auth0_claim_requirement(),
        check_session_endpoints_present(),
        check_auth0_ci_workflows_present(),
    ]

    out_dir = ROOT / "artifacts"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "security_validation_gate_report.json"
    report = {
        "ok": all(item.ok for item in checks),
        "checks": [asdict(item) for item in checks],
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    for item in checks:
        status = "PASS" if item.ok else "FAIL"
        print(f"[{status}] {item.name}: {item.details}")

    print(f"\nReport: {report_path}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
