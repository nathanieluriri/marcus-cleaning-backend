from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Literal
from core.response_envelope import document_response
from core.i18n import set_request_locale
from schemas.cleaner_schema import (
    CleanerLogin,
    CleanerOnboardingUpsertRequest,
    CleanerOut,
    CleanerRefresh,
    CleanerSignupRequest,
    CleanerUpdate,
)
from services.cleaner_service import (
    add_user,
    authenticate_user,
    authenticate_user_google,
    oauth,
    refresh_user_tokens_reduce_number_of_logins,
    remove_user,
    retrieve_users,
    retrieve_user_by_user_id,
    update_user_by_id,
    upsert_cleaner_onboarding_profile,
)
from services.auth_session_service import revoke_all_sessions, revoke_current_session, revoke_other_sessions
from security.account_status_check import check_user_account_status_and_permissions
from security.auth import verify_cleaner_token
from security.principal import AuthPrincipal
import os

router = APIRouter(prefix="/cleaners", tags=["Cleaners"])

SUCCESS_PAGE_URL = os.getenv("SUCCESS_PAGE_URL", "http://localhost:8080/success")
ERROR_PAGE_URL = os.getenv("ERROR_PAGE_URL", "http://localhost:8080/error")


class LanguageUpdateIn(BaseModel):
    language: Literal["en", "fr"]


def _with_language(payload: object, language: str | None) -> dict:
    if hasattr(payload, "model_dump"):
        data = payload.model_dump(mode="json", by_alias=True) # type: ignore[attr-defined]
    elif isinstance(payload, dict):
        data = dict(payload)
    else:
        data = {"value": payload}
    data["language"] = language or "en"
    return data


@router.get("/google/auth")
async def login_with_google_account(request: Request):
    redirect_uri = request.url_for("cleaner_auth_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback", name="cleaner_auth_callback")
async def auth_callback_user(request: Request):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo") if isinstance(token, dict) else None
    if not isinstance(user_info, dict):
        raise HTTPException(status_code=400, detail={"message": "No cleaner info found"})

    full_name = str(user_info.get("name") or "").strip()
    first_name = str(user_info.get("given_name") or full_name or "Cleaner").strip()
    last_name = str(user_info.get("family_name") or "").strip()
    email = str(user_info.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail={"message": "Google email not found"})

    cleaner = await authenticate_user_google(
        user_data=CleanerSignupRequest(
            firstName=first_name,
            lastName=last_name,
            email=email,
            password="",
        )
    )
    success_url = f"{SUCCESS_PAGE_URL}?access_token={cleaner.access_token}&refresh_token={cleaner.refresh_token}"
    return RedirectResponse(url=success_url, status_code=status.HTTP_302_FOUND)


@router.get(
    "/",
    dependencies=[Depends(check_user_account_status_and_permissions)],
)
@document_response(
    message="Cleaners fetched successfully",
    success_example=[],
)
async def list_users(start: int = 0, stop: int = 100):
    items = await retrieve_users(start=start, stop=stop)
    return items


@router.get(
    "/me",
)
@document_response(message="Cleaner profile fetched successfully")
async def get_my_users(cleaner: CleanerOut = Depends(check_user_account_status_and_permissions)):
    return cleaner


@router.post("/signup")
@document_response(
    message="Cleaner created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def signup_new_user(request: Request, user_data: CleanerSignupRequest):
    items = await add_user(user_data=user_data)
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.post("/login")
@document_response(message="Login successful")
async def login_user(request: Request, user_data: CleanerLogin):
    items = await authenticate_user(user_data=user_data)
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.post("/refresh")
@document_response(message="Tokens refreshed successfully")
async def refresh_user_tokens(
    request: Request,
    user_data: CleanerRefresh,
):
    items = await refresh_user_tokens_reduce_number_of_logins(
        user_refresh_data=user_data,
        expired_access_token="",
    )
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.put("/onboarding")
@document_response(message="Cleaner onboarding updated successfully")
async def upsert_cleaner_onboarding(
    payload: CleanerOnboardingUpsertRequest,
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    return await upsert_cleaner_onboarding_profile(
        cleaner_id=principal.user_id,
        payload=payload,
    )


@router.delete("/account")
@document_response(message="Cleaner account deleted successfully")
async def delete_user_account(cleaner: CleanerOut = Depends(check_user_account_status_and_permissions)):
    result = await remove_user(user_id=cleaner.id) # type: ignore
    return result


@router.post("/sessions/revoke-others")
@document_response(message="Other cleaner sessions revoked successfully")
async def revoke_other_cleaner_sessions(
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    access_deleted, refresh_deleted = await revoke_other_sessions(
        user_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.post("/sessions/revoke-all")
@document_response(message="All cleaner sessions revoked successfully")
async def revoke_all_cleaner_sessions(
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    access_deleted, refresh_deleted = await revoke_all_sessions(
        user_id=principal.user_id,
        auth_subject=principal.auth_subject,
        auth_provider=principal.auth_provider,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.post("/sessions/logout")
@document_response(message="Cleaner current session logged out successfully")
async def logout_cleaner_session(
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    access_deleted, refresh_deleted = await revoke_current_session(
        user_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
        auth_subject=principal.auth_subject,
        auth_provider=principal.auth_provider,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@router.get("/me/language")
@document_response(message="Language fetched successfully")
async def get_cleaner_language(
    request: Request,
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    cleaner = await retrieve_user_by_user_id(id=principal.user_id)
    language = getattr(cleaner, "preferredLanguage", "en")
    set_request_locale(request, language)
    return {"language": language}


@router.patch("/me/language")
@document_response(message="Language updated successfully")
async def update_cleaner_language(
    payload: LanguageUpdateIn,
    request: Request,
    principal: AuthPrincipal = Depends(verify_cleaner_token),
):
    updated = await update_user_by_id(
        user_id=principal.user_id,
        user_data=CleanerUpdate(preferredLanguage=payload.language),
    )
    set_request_locale(request, payload.language)
    return {"language": getattr(updated, "preferredLanguage", payload.language)}
