from __future__ import annotations

import math
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import redis
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from limits import parse
from limits.storage import RedisStorage
from limits.strategies import FixedWindowRateLimiter
from pymongo import MongoClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from celery_worker import celery_app
from core.payments.manager import PaymentManager
from core.queue.celery_provider import CeleryQueueProvider
from core.queue.manager import QueueManager
from core.endpoint_docs import apply_feature_docs_to_routes
from core.response_envelope import (
    apply_response_documentation,
    document_response,
    error_response,
    http_exception_response,
)
from core.validation_errors import format_validation_error_details
from core.scheduler import scheduler
from core.settings import get_settings
from core.role_config import build_role_rate_limits, build_role_rate_limits_csv, normalize_role
from core.i18n import (
    DEFAULT_LANGUAGE,
    LocaleResolutionError,
    parse_accept_language,
    set_request_locale,
    get_request_locale,
    translate_message,
)
from core.storage.manager import DocumentStorageManager
from repositories.tokens_repo import get_access_token
from security.auth0_verifier import get_auth0_token_verifier
from services.auth_identity_service import resolve_any_role_account_for_claims
from services.customer_app_contract_service import process_due_account_lifecycle_jobs
from services.place_service import initialize_places_http_client, shutdown_places_http_client

settings = get_settings()
BASE_DIR = Path(__file__).resolve().parent

MONGO_URI = os.getenv("MONGO_URL")
mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000) if MONGO_URI else None
redis_client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, decode_responses=True)


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestTimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Process-Time"] = str(time.perf_counter() - start_time)
        return response


class LocaleMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            header_locale = parse_accept_language(request.headers.get("Accept-Language"))
        except LocaleResolutionError as err:
            return error_response(
                status_code=422,
                message=translate_message(err.message, DEFAULT_LANGUAGE),
                data={"code": "VALIDATION_FAILED", "details": {"field": "Accept-Language"}},
                request_id=getattr(request.state, "request_id", None),
            )
        set_request_locale(request, header_locale)
        response = await call_next(request)
        response.headers["Content-Language"] = get_request_locale(request)
        return response


ROLE_RATE_LIMITS_DEFAULT = build_role_rate_limits_csv(non_admin_roles=["cleaner", "customer"])
RATE_LIMITS = build_role_rate_limits(
    os.getenv("ROLE_RATE_LIMITS"),
    fallback_csv=ROLE_RATE_LIMITS_DEFAULT,
)

storage = RedisStorage(settings.redis_url)
limiter = FixedWindowRateLimiter(storage)


async def get_user_type(request: Request) -> tuple[str, str]:
    auth_header = request.headers.get("Authorization")
    fallback_id = request.headers.get("X-Forwarded-For") or request.client.host # type: ignore

    if not auth_header or not auth_header.startswith("Bearer "):
        return fallback_id, "anonymous"

    token = auth_header.split(" ", maxsplit=1)[1]
    try:
        local_token = await get_access_token(accessToken=token)
    except Exception:
        local_token = None
    if local_token is not None:
        local_role = normalize_role(local_token.role or "anonymous")
        if local_role in RATE_LIMITS and local_token.userId:
            return str(local_token.userId), local_role

    try:
        claims = await get_auth0_token_verifier().verify_access_token(token)
        role, account = await resolve_any_role_account_for_claims(claims=claims)
    except Exception:
        return fallback_id, "anonymous"

    if not role or not account:
        return fallback_id, "anonymous"

    user_type = normalize_role(role or "anonymous")
    if user_type not in RATE_LIMITS:
        user_type = "anonymous"

    return str(getattr(account, "id", fallback_id) or fallback_id), user_type


class RateLimitingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        user_id, user_type = await get_user_type(request)
        rate_limit_rule = RATE_LIMITS[user_type]

        allowed = limiter.hit(rate_limit_rule, user_id)
        reset_time, remaining = limiter.get_window_stats(rate_limit_rule, user_id)
        seconds_until_reset = max(math.ceil(reset_time - time.time()), 0)

        headers = {
            "X-User-Id": user_id,
            "X-User-Type": user_type,
            "X-RateLimit-Limit": str(rate_limit_rule.amount),
            "X-RateLimit-Remaining": str(max(remaining, 0)),
            "X-RateLimit-Reset": str(seconds_until_reset),
        }

        if not allowed:
            headers["Retry-After"] = str(seconds_until_reset)
            return error_response(
                status_code=429,
                message=translate_message("Too Many Requests", get_request_locale(request)),
                data={
                    "code": "TOO_MANY_REQUESTS",
                    "details": {
                        "retry_after_seconds": seconds_until_reset,
                        "user_type": user_type,
                    },
                },
                headers=headers,
                request_id=getattr(request.state, "request_id", None),
            )

        response = await call_next(request)
        for key, value in headers.items():
            response.headers[key] = value
        return response



def apscheduler_heartbeat() -> None:
    redis_client.set("apscheduler:heartbeat", str(time.time()), ex=60)


def enqueue_pending_payment_reconciliation() -> None:
    QueueManager.get_instance().enqueue(
        "reconcile_pending_payments",
        {"limit": settings.payment_reconcile_poll_limit},
    )


async def process_pending_account_lifecycle_jobs() -> None:
    await process_due_account_lifecycle_jobs(limit=100)


@asynccontextmanager
async def lifespan(app: FastAPI):
    QueueManager.configure(CeleryQueueProvider(celery_app=celery_app))
    DocumentStorageManager.configure_from_settings()
    PaymentManager.configure_from_settings()

    scheduler.add_job(
        apscheduler_heartbeat,
        trigger=IntervalTrigger(seconds=15),
        id="apscheduler_heartbeat",
        name="APScheduler Heartbeat",
        replace_existing=True,
    )
    scheduler.add_job(
        enqueue_pending_payment_reconciliation,
        trigger=IntervalTrigger(seconds=settings.payment_reconcile_poll_interval_seconds),
        id="payment_reconcile_pending",
        name="Reconcile Pending Payments",
        replace_existing=True,
    )
    scheduler.add_job(
        process_pending_account_lifecycle_jobs,
        trigger=IntervalTrigger(seconds=60),
        id="account_lifecycle_processor",
        name="Process Account Lifecycle Jobs",
        replace_existing=True,
    )
    scheduler.start()
    await initialize_places_http_client()

    try:
        yield
    finally:
        await shutdown_places_http_client()
        scheduler.shutdown()


app = FastAPI(lifespan=lifespan, title="REST API")
app.add_middleware(RequestIdMiddleware)
app.add_middleware(LocaleMiddleware)
app.add_middleware(RequestTimingMiddleware)
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret_key or "dev-only-session-secret")
app.add_middleware(RateLimitingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins) if settings.cors_origins else ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    return http_exception_response(exc=exc, request=request)


@app.exception_handler(RequestValidationError)
async def custom_validation_exception_handler(request: Request, exc: RequestValidationError):
    return error_response(
        status_code=422,
        message=translate_message("Validation error", get_request_locale(request)),
        data={"code": "VALIDATION_FAILED", "details": format_validation_error_details(exc.errors())}, # type: ignore
        request_id=getattr(request.state, "request_id", None),
    )


@app.exception_handler(Exception)
async def custom_exception_handler(request: Request, exc: Exception):
    details = str(exc) if (settings.debug_include_error_details and not settings.is_production) else None
    return error_response(
        status_code=500,
        message=translate_message("Internal Server Error", get_request_locale(request)),
        data={"code": "INTERNAL_ERROR", "details": details},
        request_id=getattr(request.state, "request_id", None),
    )


@app.get("/", tags=["Health"], include_in_schema=False)
@document_response(
    message="Successfully fetched data",
    success_example={"message": "Hello from FasterAPI!"},
)
def read_root(request: Request):
    return {"message": "Hello from FasterAPI!", "request_id": getattr(request.state, "request_id", None)}


@app.get("/health", tags=["Health"])
@document_response(
    message="Health check completed",
    success_example={"status": "healthy", "services": {"mongo": "healthy", "redis": "healthy"}},
)
async def health_check():
    services: dict[str, dict[str, str | float]] = {}
    overall_status = "healthy"

    if mongo_client is not None:
        start = time.perf_counter()
        try:
            mongo_client.admin.command("ping")
            services["mongo"] = {
                "status": "healthy",
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "message": "MongoDB ping successful",
            }
        except Exception as exc:
            overall_status = "degraded"
            services["mongo"] = {
                "status": "unhealthy",
                "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                "message": str(exc),
            }

    start = time.perf_counter()
    try:
        redis_client.ping()
        services["redis"] = {
            "status": "healthy",
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "message": "Redis ping successful",
        }
    except Exception as exc:
        overall_status = "degraded"
        services["redis"] = {
            "status": "unhealthy",
            "latency_ms": round((time.perf_counter() - start) * 1000, 2),
            "message": str(exc),
        }

    aps_heartbeat = redis_client.get("apscheduler:heartbeat")
    if aps_heartbeat:
        age = time.time() - float(aps_heartbeat) # type: ignore
        services["apscheduler"] = {
            "status": "healthy" if age <= 30 else "degraded",
            "latency_ms": 0,
            "message": f"Last heartbeat {int(age)}s ago",
        }
        if age > 30:
            overall_status = "degraded"
    else:
        overall_status = "degraded"
        services["apscheduler"] = {
            "status": "unhealthy",
            "latency_ms": 0,
            "message": "No heartbeat found",
        }

    return {
        "status": overall_status,
        "timestamp": datetime.utcnow().isoformat(),
        "services": services,
    }


# --- auto-routes-start ---
from api.v1.admin_route import router as v1_admin_route_router
from api.v1.booking_route import router as v1_booking_route_router
from api.v1.cleaner_route import router as v1_cleaner_route_router
from api.v1.customer_route import customer_app_router as v1_customer_app_route_router
from api.v1.customer_route import router as v1_customer_route_router
from api.v1.documents_route import router as v1_documents_route_router
from api.v1.payments_route import router as v1_payments_route_router
from api.v1.place_route import router as v1_place_route_router
from api.v1.review import router as v1_review_route_router
from api.web.payment_template_route import router as web_payment_template_router

app.include_router(v1_admin_route_router, prefix='/v1')
app.include_router(v1_booking_route_router, prefix='/v1')
app.include_router(v1_cleaner_route_router, prefix='/v1')
app.include_router(v1_customer_app_route_router, prefix='/v1')
app.include_router(v1_customer_route_router, prefix='/v1')
app.include_router(v1_documents_route_router, prefix='/v1')
app.include_router(v1_payments_route_router, prefix='/v1')
app.include_router(v1_place_route_router, prefix='/v1')
app.include_router(v1_review_route_router, prefix='/v1')
app.include_router(web_payment_template_router)
# --- auto-routes-end ---

apply_feature_docs_to_routes(app.routes)
apply_response_documentation(app)
