from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

SUPPORTED_PAYMENT_PROVIDERS = {"flutterwave", "stripe", "test"}


def _split_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return tuple()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _env(name: str) -> str | None:
    raw_value = os.getenv(name)
    if raw_value is None:
        return None
    normalized = raw_value.strip()
    return normalized or None


def collect_missing_required_env_vars() -> list[str]:
    missing: list[str] = []

    always_required = (
        "SECRET_KEY",
        "SESSION_SECRET_KEY",
        "GOOGLE_MAPS_API_KEY",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "SUCCESS_PAGE_URL",
        "ERROR_PAGE_URL",
        "EMAIL_USERNAME",
        "EMAIL_PASSWORD",
        "EMAIL_HOST",
        "EMAIL_PORT",
        "CELERY_BROKER_URL",
        "CELERY_RESULT_BACKEND",
    )
    for var_name in always_required:
        if _env(var_name) is None:
            missing.append(var_name)

    db_type = (_env("DB_TYPE") or "sqlite").lower()
    if db_type == "mongodb":
        if _env("MONGO_URL") is None:
            missing.append("MONGO_URL")
        if _env("DB_NAME") is None:
            missing.append("DB_NAME")

    storage_backend = (_env("STORAGE_BACKEND") or "local").lower()
    if storage_backend == "s3" and _env("S3_BUCKET_NAME") is None:
        missing.append("S3_BUCKET_NAME")

    payment_provider = (_env("PAYMENT_DEFAULT_PROVIDER") or "flutterwave").lower()
    if payment_provider == "flutterwave":
        for var_name in ("FLUTTERWAVE_SECRET_KEY", "FLW_WEBHOOK_SECRET_HASH"):
            if _env(var_name) is None:
                missing.append(var_name)
    elif payment_provider == "stripe":
        for var_name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
            if _env(var_name) is None:
                missing.append(var_name)
    elif payment_provider == "test":
        if _env("TEST_PAYMENT_BASE_URL") is None:
            missing.append("TEST_PAYMENT_BASE_URL")

    return sorted(set(missing))


def collect_invalid_env_values() -> list[str]:
    invalid_values: list[str] = []

    payment_provider = (_env("PAYMENT_DEFAULT_PROVIDER") or "flutterwave").lower()
    if payment_provider not in SUPPORTED_PAYMENT_PROVIDERS:
        invalid_values.append(
            "PAYMENT_DEFAULT_PROVIDER must be one of: flutterwave, stripe, test"
        )

    storage_backend = (_env("STORAGE_BACKEND") or "local").lower()
    if storage_backend not in {"local", "s3"}:
        invalid_values.append("STORAGE_BACKEND must be one of: local, s3")

    email_port = _env("EMAIL_PORT")
    if email_port is not None:
        try:
            parsed_port = int(email_port)
            if parsed_port <= 0:
                raise ValueError("must be positive")
        except ValueError:
            invalid_values.append("EMAIL_PORT must be a positive integer")

    db_type = (_env("DB_TYPE") or "sqlite").lower()
    if db_type not in {"sqlite", "mongodb"}:
        invalid_values.append("DB_TYPE must be one of: sqlite, mongodb")

    return invalid_values


def validate_required_environment() -> None:
    missing_vars = collect_missing_required_env_vars()
    invalid_values = collect_invalid_env_values()
    if not missing_vars and not invalid_values:
        return

    message_lines = ["Application startup blocked by invalid environment configuration."]
    if missing_vars:
        message_lines.append("")
        message_lines.append("Missing required environment variables:")
        message_lines.extend(f"- {name}" for name in missing_vars)
    if invalid_values:
        message_lines.append("")
        message_lines.append("Invalid environment values:")
        message_lines.extend(f"- {message}" for message in invalid_values)
    raise RuntimeError("\n".join(message_lines))


@dataclass(frozen=True)
class Settings:
    env: str
    secret_key: str
    session_secret_key: str
    cors_origins: tuple[str, ...]
    debug_include_error_details: bool
    redis_url: str
    s3_bucket_name: str | None
    s3_region: str | None
    s3_endpoint_url: str | None
    storage_backend: str
    storage_local_root: str
    payment_default_provider: str
    stripe_secret_key: str | None
    stripe_webhook_secret: str | None
    flutterwave_secret_key: str | None
    flutterwave_public_key: str | None
    flutterwave_webhook_secret_hash: str | None
    test_payment_base_url: str | None
    test_payment_webhook_secret_hash: str | None
    booking_allow_accept_on_pending_payment: bool

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    validate_required_environment()

    env = os.getenv("ENV", "development")
    secret_key = os.getenv("SECRET_KEY", "")
    session_secret_key = os.getenv("SESSION_SECRET_KEY", "")

    default_redis = (
        os.getenv("CELERY_BROKER_URL")
        or os.getenv("REDIS_URL")
        or f"redis://{os.getenv('REDIS_HOST', '127.0.0.1')}:{os.getenv('REDIS_PORT', '6379')}/0"
    )

    settings = Settings(
        env=env,
        secret_key=secret_key,
        session_secret_key=session_secret_key,
        cors_origins=_split_csv(os.getenv("CORS_ORIGINS")),
        debug_include_error_details=os.getenv("DEBUG_INCLUDE_ERROR_DETAILS", "false").lower()
        in {"1", "true", "yes"},
        redis_url=default_redis,
        s3_bucket_name=os.getenv("S3_BUCKET_NAME"),
        s3_region=os.getenv("S3_REGION"),
        s3_endpoint_url=os.getenv("S3_ENDPOINT_URL"),
        storage_backend=os.getenv("STORAGE_BACKEND", "local").lower(),
        storage_local_root=os.getenv("STORAGE_LOCAL_ROOT", "uploads"),
        payment_default_provider=os.getenv("PAYMENT_DEFAULT_PROVIDER", "flutterwave").lower(),
        stripe_secret_key=os.getenv("STRIPE_SECRET_KEY"),
        stripe_webhook_secret=os.getenv("STRIPE_WEBHOOK_SECRET"),
        flutterwave_secret_key=os.getenv("FLUTTERWAVE_SECRET_KEY"),
        flutterwave_public_key=os.getenv("FLUTTERWAVE_PUBLIC_KEY"),
        flutterwave_webhook_secret_hash=os.getenv("FLW_WEBHOOK_SECRET_HASH"),
        test_payment_base_url=os.getenv("TEST_PAYMENT_BASE_URL"),
        test_payment_webhook_secret_hash=os.getenv("TEST_PAYMENT_WEBHOOK_SECRET_HASH"),
        booking_allow_accept_on_pending_payment=(
            os.getenv("BOOKING_ALLOW_ACCEPT_ON_PENDING_PAYMENT", "true").lower() in {"1", "true", "yes"}
        ),
    )

    if settings.is_production:
        if not settings.secret_key:
            raise RuntimeError("SECRET_KEY is required when ENV=production")
        if not settings.session_secret_key:
            raise RuntimeError("SESSION_SECRET_KEY is required when ENV=production")

    return settings
