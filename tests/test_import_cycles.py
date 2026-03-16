import importlib


def test_account_status_check_import_does_not_raise():
    module = importlib.import_module("security.account_status_check")
    assert module is not None


def test_auth_identity_and_role_services_import_does_not_raise():
    assert importlib.import_module("services.auth_identity_service") is not None
    assert importlib.import_module("services.admin_service") is not None
    assert importlib.import_module("services.cleaner_service") is not None
    assert importlib.import_module("services.customer_service") is not None
