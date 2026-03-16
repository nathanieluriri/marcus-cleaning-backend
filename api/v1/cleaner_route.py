from fastapi import APIRouter, Depends, HTTPException, Request, status
from core.response_envelope import document_response
from schemas.cleaner_schema import (
    CleanerLogin,
    CleanerOnboardingUpsertRequest,
    CleanerOut,
    CleanerRefresh,
    CleanerSignupRequest,
)
from services.cleaner_service import (
    add_user,
    authenticate_user,
    refresh_user_tokens_reduce_number_of_logins,
    remove_user,
    retrieve_users,
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


@router.get("/google/auth")
async def login_with_google_account(request: Request):
    _ = request
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Google login is now handled by Auth0 Universal Login",
    )


@router.get("/auth/callback")
async def auth_callback_user(request: Request):
    _ = request
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Google callback is now handled by Auth0 Universal Login",
    )


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
async def signup_new_user(user_data: CleanerSignupRequest):
    items = await add_user(user_data=user_data)
    return items


@router.post("/login")
@document_response(message="Login successful")
async def login_user(user_data: CleanerLogin):
    items = await authenticate_user(user_data=user_data)
    return items


@router.post("/refresh")
@document_response(message="Tokens refreshed successfully")
async def refresh_user_tokens(
    user_data: CleanerRefresh,
):
    items = await refresh_user_tokens_reduce_number_of_logins(
        user_refresh_data=user_data,
        expired_access_token="",
    )
    return items


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
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}
