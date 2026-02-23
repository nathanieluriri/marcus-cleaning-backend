from __future__ import annotations

from typing import Any, Iterable


_REQUEST_LOCATIONS = {"body", "query", "path", "header", "cookie"}


def _normalize_error_path(location_parts: Iterable[Any]) -> tuple[str, str]:
    parts = [str(part) for part in location_parts]
    if not parts:
        return "body", "(root)"

    location = parts[0]
    if location in _REQUEST_LOCATIONS:
        path_parts = parts[1:]
    else:
        path_parts = parts

    if not path_parts:
        return location, "(root)"

    return location, ".".join(path_parts)


def _build_summary(*, missing_fields: list[str], error_count: int) -> str:
    if missing_fields:
        noun = "field" if len(missing_fields) == 1 else "fields"
        fields = ", ".join(missing_fields)
        return f"Validation failed: missing required {noun}: {fields}."

    noun = "field" if error_count == 1 else "fields"
    return f"Validation failed for {error_count} {noun}."


def format_validation_error_details(errors: list[dict[str, Any]]) -> dict[str, Any]:
    field_errors: list[dict[str, str]] = []
    missing_fields: list[str] = []

    for error in errors:
        raw_loc = error.get("loc")
        if isinstance(raw_loc, (list, tuple)):
            location, path = _normalize_error_path(raw_loc)
        elif raw_loc is None:
            location, path = "body", "(root)"
        else:
            location, path = _normalize_error_path([raw_loc])

        error_type = str(error.get("type", "validation_error"))
        message = str(error.get("msg", "Invalid value"))

        field_errors.append(
            {
                "path": path,
                "location": location,
                "message": message,
                "errorType": error_type,
            }
        )

        if error_type == "missing" and path not in missing_fields:
            missing_fields.append(path)

    return {
        "summary": _build_summary(missing_fields=missing_fields, error_count=len(field_errors)),
        "missingFields": missing_fields,
        "fieldErrors": field_errors,
        "errors": errors,
    }
