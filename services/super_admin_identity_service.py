from __future__ import annotations

from typing import Final

SUPER_ADMIN_STATIC_ID: Final[str] = "656f7ac12b9d4f6c9e2b9f7d"

_KNOWN_SUPER_ADMIN_SUBJECTS: set[str] = set()


def register_super_admin_subject(subject: str | None) -> None:
    normalized = (subject or "").strip()
    if normalized:
        _KNOWN_SUPER_ADMIN_SUBJECTS.add(normalized)


def is_known_super_admin_subject(subject: str | None) -> bool:
    normalized = (subject or "").strip()
    if not normalized:
        return False
    return normalized in _KNOWN_SUPER_ADMIN_SUBJECTS


def get_known_super_admin_subject() -> str | None:
    if not _KNOWN_SUPER_ADMIN_SUBJECTS:
        return None
    return sorted(_KNOWN_SUPER_ADMIN_SUBJECTS)[0]
