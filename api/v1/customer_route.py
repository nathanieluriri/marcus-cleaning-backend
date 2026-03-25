import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel

from core.response_envelope import document_response
from schemas.customer_app_contract import (
    AccountDeactivateRequestContract,
    AccountDeleteRequestContract,
    AuthPasswordResetRequestContract,
    AuthSignInRequestContract,
    AuthSignUpRequestContract,
    BookingCreateRequestContract,
    PrivacyPreferencesPatchContract,
    CustomerProfileEditRequestContract,
    CleanerFiltersContract,
    CleanerReviewFiltersContract,
    NotificationPreferencesPatchContract,
    SecurityPreferencesPatchContract,
)
from schemas.customer_schema import CustomerLogin, CustomerOut, CustomerRefresh, CustomerSignupRequest
from schemas.customer_schema import CustomerUpdate
from schemas.payment_schema import PaymentMethodCreateIn, PaymentMethodUpdateIn
from schemas.saved_address import CustomerSavedAddressCreateRequest, SavedAddressPatchRequest
from security.booking_access_check import require_customer_principal
from services.customer_service import (
    add_user,
    authenticate_user,
    authenticate_user_google,
    oauth,
    refresh_user_tokens_reduce_number_of_logins,
    remove_user,
    retrieve_users,
    retrieve_user_by_user_id,
    update_user_by_id,
)
from services.saved_address_service import (
    create_my_saved_address,
    delete_my_saved_address,
    list_my_saved_addresses,
    set_default_saved_address,
    update_my_saved_address,
)
from services.customer_app_contract_service import (
    create_booking_contract,
    delete_notification_contract,
    fetch_customer_home_page,
    get_customer_profile_contract,
    fetch_settings_snapshot_contract,
    get_cleaner_profile_contract,
    list_booking_extras_by_service,
    list_cleaner_reviews_contract,
    list_contract_cleaners,
    list_notifications_contract,
    mark_all_notifications_as_read_contract,
    mark_notification_as_read_contract,
    request_password_reset_contract,
    request_account_deactivation_contract,
    request_account_deletion_contract,
    revoke_session_by_id_contract,
    revoke_other_sessions_contract,
    sign_in_customer_contract,
    sign_up_customer_contract,
    update_notification_preferences_contract,
    update_privacy_preferences_contract,
    update_security_preferences_contract,
    update_customer_profile_contract,
)
from services.auth_session_service import revoke_all_sessions, revoke_current_session
from services.payment_service import (
    add_payment_method_for_owner,
    delete_payment_method_for_owner,
    list_payment_methods_for_owner,
    update_payment_method_for_owner,
)
from security.account_status_check import check_user_account_status_and_permissions
from security.principal import AuthPrincipal
from core.i18n import set_request_locale

router = APIRouter(prefix="/customers", tags=["Customers"])
customer_app_router = APIRouter(tags=["Customers"])

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
    redirect_uri = request.url_for("customer_auth_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback", name="customer_auth_callback")
async def auth_callback_user(request: Request):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo") if isinstance(token, dict) else None
    if not isinstance(user_info, dict):
        raise HTTPException(status_code=400, detail={"message": "No customer info found"})

    full_name = str(user_info.get("name") or "").strip()
    first_name = str(user_info.get("given_name") or full_name or "Customer").strip()
    last_name = str(user_info.get("family_name") or "").strip()
    email = str(user_info.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail={"message": "Google email not found"})

    customer = await authenticate_user_google(
        user_data=CustomerSignupRequest(
            firstName=first_name,
            lastName=last_name,
            email=email,
            password="",
        )
    )
    success_url = f"{SUCCESS_PAGE_URL}?access_token={customer.access_token}&refresh_token={customer.refresh_token}"
    return RedirectResponse(url=success_url, status_code=status.HTTP_302_FOUND)


@router.get(
    "/",
    dependencies=[Depends(check_user_account_status_and_permissions)],
)
@document_response(
    message="Customers fetched successfully",
    success_example=[],
)
async def list_users(start: int = 0, stop: int = 100):
    items = await retrieve_users(start=start, stop=stop)
    return items


@router.get(
    "/me",
)
@document_response(message="Customer profile fetched successfully")
async def get_my_users(customer: CustomerOut = Depends(check_user_account_status_and_permissions)):
    return customer


@router.patch("/me")
@document_response(message="Customer profile updated successfully")
async def update_my_profile(
    payload: CustomerProfileEditRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_customer_profile_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@router.post("/signup")
@document_response(
    message="Customer created successfully",
    status_code=status.HTTP_201_CREATED,
)
async def signup_new_user(request: Request, user_data: CustomerSignupRequest):
    items = await add_user(user_data=user_data)
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.post("/login")
@document_response(message="Login successful")
async def login_user(request: Request, user_data: CustomerLogin):
    items = await authenticate_user(user_data=user_data)
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.post("/refresh")
@document_response(message="Tokens refreshed successfully")
async def refresh_user_tokens(
    request: Request,
    user_data: CustomerRefresh,
):
    items = await refresh_user_tokens_reduce_number_of_logins(
        user_refresh_data=user_data,
        expired_access_token="",
    )
    set_request_locale(request, getattr(items, "preferredLanguage", "en"))
    return _with_language(items, getattr(items, "preferredLanguage", "en"))


@router.delete("/account")
@document_response(message="Customer account deleted successfully")
async def delete_user_account(customer: CustomerOut = Depends(check_user_account_status_and_permissions)):
    result = await remove_user(user_id=customer.id) # type: ignore
    return result


@router.get("/me/addresses")
@document_response(message="Saved addresses fetched successfully", success_example=[])
async def list_my_addresses(
    start: int = Query(default=0, ge=0),
    stop: int = Query(default=20, gt=0, le=100),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await list_my_saved_addresses(user_id=principal.user_id, start=start, stop=stop)


@router.post("/me/addresses", status_code=status.HTTP_201_CREATED)
@document_response(message="Saved address created successfully", status_code=status.HTTP_201_CREATED)
async def create_my_address(
    payload: CustomerSavedAddressCreateRequest,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await create_my_saved_address(user_id=principal.user_id, payload=payload)


@router.patch("/me/addresses/{address_id}")
@document_response(message="Saved address updated successfully")
async def update_my_address(
    payload: SavedAddressPatchRequest ,
    address_id: str = Path(..., description="Saved address identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_my_saved_address(user_id=principal.user_id, address_id=address_id, payload=payload)


@router.delete("/me/addresses/{address_id}")
@document_response(message="Saved address deleted successfully")
async def delete_my_address(
    address_id: str = Path(..., description="Saved address identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await delete_my_saved_address(user_id=principal.user_id, address_id=address_id)


@router.post("/me/addresses/{address_id}/set-default")
@document_response(message="Default saved address updated successfully")
async def set_default_my_address(
    address_id: str = Path(..., description="Saved address identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await set_default_saved_address(user_id=principal.user_id, address_id=address_id)


@router.get("/me/language")
@document_response(message="Language fetched successfully")
async def get_customer_language(
    request: Request,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    customer = await retrieve_user_by_user_id(id=principal.user_id)
    language = getattr(customer, "preferredLanguage", "en")
    set_request_locale(request, language)
    return {"language": language}


@router.patch("/me/language")
@document_response(message="Language updated successfully")
async def update_customer_language(
    payload: LanguageUpdateIn,
    request: Request,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    updated = await update_user_by_id(
        user_id=principal.user_id,
        user_data=CustomerUpdate(preferredLanguage=payload.language),
    )
    set_request_locale(request, payload.language)
    return {"language": getattr(updated, "preferredLanguage", payload.language)}


@router.post("/sign-in")
@document_response(message="Login successful")
async def sign_in(request: Request, payload: AuthSignInRequestContract):
    response = await sign_in_customer_contract(payload)
    set_request_locale(request, getattr(response, "language", "en"))
    return response


@router.post("/sign-up")
@document_response(message="Customer created successfully", status_code=status.HTTP_201_CREATED)
async def sign_up(request: Request, payload: AuthSignUpRequestContract):
    response = await sign_up_customer_contract(payload)
    set_request_locale(request, getattr(response, "language", "en"))
    return response


@router.post("/password-reset/request")
@document_response(message="Password reset request accepted")
async def request_password_reset(payload: AuthPasswordResetRequestContract):
    await request_password_reset_contract(payload)
    return {"accepted": True}


@customer_app_router.get("/home")
@document_response(message="Home page fetched successfully")
async def fetch_home_page(principal: AuthPrincipal = Depends(require_customer_principal)):
    return await fetch_customer_home_page(principal)


@customer_app_router.get("/bookings/services/{service_id}/extras")
@document_response(message="Extras fetched successfully", success_example=[])
async def fetch_extras_by_service(
    service_id: str = Path(..., description="Service identifier"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    return await list_booking_extras_by_service(service_id=service_id)


@customer_app_router.get("/bookings/cleaners")
@document_response(message="Cleaners fetched successfully", success_example=[])
async def fetch_available_cleaners(
    min_rating: float | None = Query(default=None, alias="minRating", ge=0.0, le=5.0),
    max_hourly_rate: float | None = Query(default=None, alias="maxHourlyRate", gt=0),
    only_available_now: bool | None = Query(default=None, alias="onlyAvailableNow"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    return await list_contract_cleaners(
        CleanerFiltersContract(
            minRating=min_rating,
            maxHourlyRate=max_hourly_rate,
            onlyAvailableNow=only_available_now,
        )
    )


@customer_app_router.get("/bookings/cleaners/{cleaner_id}")
@document_response(message="Cleaner profile fetched successfully")
async def fetch_cleaner_profile(
    cleaner_id: str = Path(..., description="Cleaner identifier"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    return await get_cleaner_profile_contract(cleaner_id=cleaner_id)


@customer_app_router.get("/bookings/cleaners/{cleaner_id}/reviews")
@document_response(message="Cleaner reviews fetched successfully")
async def fetch_cleaner_reviews(
    cleaner_id: str = Path(..., description="Cleaner identifier"),
    cursor: str | None = Query(default=None),
    page_size: int = Query(default=10, alias="pageSize", ge=1, le=50),
    stars: int | None = Query(default=None, ge=1, le=5),
    time_period: str = Query(default="all", alias="timePeriod"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    filters = CleanerReviewFiltersContract(
        cursor=cursor,
        pageSize=page_size,
        stars=stars,
        timePeriod=time_period, # type: ignore
    )
    return await list_cleaner_reviews_contract(cleaner_id=cleaner_id, filters=filters)


@customer_app_router.post("/bookings/create")
@document_response(message="Booking created successfully")
async def create_booking(
    payload: BookingCreateRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await create_booking_contract(principal=principal, payload=payload)


@customer_app_router.get("/notifications")
@document_response(message="Notifications fetched successfully", success_example=[])
async def fetch_notifications(
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    return await list_notifications_contract(page=page, page_size=page_size)


@customer_app_router.post("/notifications/{notification_id}/read")
@document_response(message="Notification marked as read")
async def mark_notification_as_read(
    notification_id: str = Path(..., description="Notification identifier"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    await mark_notification_as_read_contract(notification_id)
    return {"updated": True}


@customer_app_router.post("/notifications/read-all")
@document_response(message="All notifications marked as read")
async def mark_all_notifications_as_read(
    _: AuthPrincipal = Depends(require_customer_principal),
):
    await mark_all_notifications_as_read_contract()
    return {"updated": True}


@customer_app_router.delete("/notifications/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(
    notification_id: str = Path(..., description="Notification identifier"),
    _: AuthPrincipal = Depends(require_customer_principal),
):
    await delete_notification_contract(notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@customer_app_router.get("/settings")
@document_response(message="Settings snapshot fetched successfully")
async def fetch_settings_snapshot(
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await fetch_settings_snapshot_contract(customer_id=principal.user_id)


@customer_app_router.patch("/settings/notifications")
@document_response(message="Notification preferences updated successfully")
async def patch_notification_preferences(
    payload: NotificationPreferencesPatchContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_notification_preferences_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.patch("/settings/security")
@document_response(message="Security preferences updated successfully")
async def patch_security_preferences(
    payload: SecurityPreferencesPatchContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_security_preferences_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.post("/settings/sessions/revoke-others")
@document_response(message="Other sessions revoked successfully")
async def revoke_other_sessions(
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await revoke_other_sessions_contract(
        customer_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
    )


@customer_app_router.post("/settings/sessions/revoke-all")
@document_response(message="All sessions revoked successfully")
async def revoke_all_customer_sessions(
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    access_deleted, refresh_deleted = await revoke_all_sessions(
        user_id=principal.user_id,
        auth_subject=principal.auth_subject,
        auth_provider=principal.auth_provider,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@customer_app_router.post("/settings/sessions/logout")
@document_response(message="Current session logged out successfully")
async def logout_customer_session(
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    access_deleted, refresh_deleted = await revoke_current_session(
        user_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
        auth_subject=principal.auth_subject,
        auth_provider=principal.auth_provider,
    )
    return {"revokedAccessSessions": access_deleted, "revokedRefreshSessions": refresh_deleted}


@customer_app_router.post("/settings/account/deactivate")
@document_response(message="Account deactivation request accepted")
async def request_account_deactivation(
    payload: AccountDeactivateRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await request_account_deactivation_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.post("/settings/account/delete")
@document_response(message="Account deletion request accepted")
async def request_account_deletion(
    payload: AccountDeleteRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await request_account_deletion_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.get("/profile/me")
@document_response(message="Customer profile fetched successfully")
async def fetch_profile_me(
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await get_customer_profile_contract(customer_id=principal.user_id)


@customer_app_router.patch("/profile/me")
@document_response(message="Customer profile updated successfully")
async def patch_profile_me(
    payload: CustomerProfileEditRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_customer_profile_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.get("/profile/addresses")
@document_response(message="Saved addresses fetched successfully", success_example=[])
async def list_profile_addresses(
    cursor: str | None = Query(default=None),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    start = int(cursor) if cursor and cursor.isdigit() else 0
    stop = start + page_size
    return await list_my_saved_addresses(user_id=principal.user_id, start=start, stop=stop)


@customer_app_router.post("/profile/addresses", status_code=status.HTTP_201_CREATED)
@document_response(message="Saved address created successfully", status_code=status.HTTP_201_CREATED)
async def create_profile_address(
    payload: CustomerSavedAddressCreateRequest,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await create_my_saved_address(user_id=principal.user_id, payload=payload)


@customer_app_router.patch("/profile/addresses/{address_id}")
@document_response(message="Saved address updated successfully")
async def patch_profile_address(
    payload: SavedAddressPatchRequest,
    address_id: str = Path(..., description="Saved address identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_my_saved_address(user_id=principal.user_id, address_id=address_id, payload=payload)


@customer_app_router.delete("/profile/addresses/{address_id}")
@document_response(message="Saved address deleted successfully")
async def remove_profile_address(
    address_id: str = Path(..., description="Saved address identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await delete_my_saved_address(user_id=principal.user_id, address_id=address_id)


@customer_app_router.get("/profile/payment-methods")
@document_response(message="Payment methods fetched successfully", success_example=[])
async def list_profile_payment_methods(
    cursor: str | None = Query(default=None),
    page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    start = int(cursor) if cursor and cursor.isdigit() else 0
    stop = start + page_size
    return await list_payment_methods_for_owner(owner_id=principal.user_id, start=start, stop=stop)


@customer_app_router.post("/profile/payment-methods", status_code=status.HTTP_201_CREATED)
@document_response(message="Payment method created successfully", status_code=status.HTTP_201_CREATED)
async def create_profile_payment_method(
    payload: PaymentMethodCreateIn,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await add_payment_method_for_owner(owner_id=principal.user_id, payload=payload)


@customer_app_router.patch("/profile/payment-methods/{payment_method_id}")
@document_response(message="Payment method updated successfully")
async def patch_profile_payment_method(
    payload: PaymentMethodUpdateIn,
    payment_method_id: str = Path(..., description="Payment method identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_payment_method_for_owner(
        owner_id=principal.user_id,
        method_id=payment_method_id,
        payload=payload,
    )


@customer_app_router.delete("/profile/payment-methods/{payment_method_id}")
@document_response(message="Payment method deleted successfully")
async def remove_profile_payment_method(
    payment_method_id: str = Path(..., description="Payment method identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await delete_payment_method_for_owner(owner_id=principal.user_id, method_id=payment_method_id)


@customer_app_router.patch("/settings/privacy")
@document_response(message="Privacy preferences updated successfully")
async def patch_privacy_preferences(
    payload: PrivacyPreferencesPatchContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await update_privacy_preferences_contract(
        customer_id=principal.user_id,
        payload=payload,
    )


@customer_app_router.delete("/settings/security/sessions/{session_id}")
@document_response(message="Session revoked successfully")
async def revoke_customer_session_by_id(
    session_id: str = Path(..., description="Access-token session identifier"),
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await revoke_session_by_id_contract(
        customer_id=principal.user_id,
        current_access_token_id=principal.access_token_id,
        session_id=session_id,
    )


@customer_app_router.delete("/settings/account")
@document_response(message="Account deletion request accepted")
async def delete_account_alias(
    payload: AccountDeleteRequestContract,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await request_account_deletion_contract(
        customer_id=principal.user_id,
        payload=payload,
    )
