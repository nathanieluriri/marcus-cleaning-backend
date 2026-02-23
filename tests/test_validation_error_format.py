from core.validation_errors import format_validation_error_details


def test_missing_required_field_summary_is_readable():
    errors = [
        {
            "type": "missing",
            "loc": ("body", "loginType"),
            "msg": "Field required",
            "input": {
                "firstName": "string",
                "lastName": "string",
                "email": "user@example.com",
                "password": "string",
            },
        }
    ]

    details = format_validation_error_details(errors)

    assert details["summary"] == "Validation failed: missing required field: loginType."
    assert details["missingFields"] == ["loginType"]
    assert details["fieldErrors"] == [
        {
            "path": "loginType",
            "location": "body",
            "message": "Field required",
            "errorType": "missing",
        }
    ]
    assert details["errors"] == errors


def test_invalid_enum_value_has_field_error_without_missing_summary():
    errors = [
        {
            "type": "enum",
            "loc": ("body", "loginType"),
            "msg": "Input should be 'GOOGLE' or 'EMAIL'",
            "input": "PHONE",
        }
    ]

    details = format_validation_error_details(errors)

    assert details["summary"] == "Validation failed for 1 field."
    assert details["missingFields"] == []
    assert details["fieldErrors"][0]["path"] == "loginType"
    assert details["fieldErrors"][0]["errorType"] == "enum"


def test_extra_forbidden_field_is_normalized():
    errors = [
        {
            "type": "extra_forbidden",
            "loc": ("body", "permissionList"),
            "msg": "Extra inputs are not permitted",
            "input": {"permissions": []},
        }
    ]

    details = format_validation_error_details(errors)

    assert details["summary"] == "Validation failed for 1 field."
    assert details["missingFields"] == []
    assert details["fieldErrors"] == [
        {
            "path": "permissionList",
            "location": "body",
            "message": "Extra inputs are not permitted",
            "errorType": "extra_forbidden",
        }
    ]


def test_multiple_missing_fields_are_deduplicated_and_listed():
    errors = [
        {"type": "missing", "loc": ("body", "firstName"), "msg": "Field required", "input": {}},
        {"type": "missing", "loc": ("body", "lastName"), "msg": "Field required", "input": {}},
        {"type": "missing", "loc": ("body", "firstName"), "msg": "Field required", "input": {}},
    ]

    details = format_validation_error_details(errors)

    assert details["summary"] == "Validation failed: missing required fields: firstName, lastName."
    assert details["missingFields"] == ["firstName", "lastName"]
