import os

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import RedirectResponse, Response

from core.response_envelope import document_response
from schemas.customer_app_contract import (
    AccountDeactivateRequestContract,
    AccountDeleteRequestContract,
    AuthPasswordResetRequestContract,
    AuthSignInRequestContract,
    AuthSignUpRequestContract,
    BookingCreateRequestContract,
    CustomerProfileEditRequestContract,
    CleanerFiltersContract,
    CleanerReviewFiltersContract,
    NotificationPreferencesPatchContract,
    SecurityPreferencesPatchContract,
)
from schemas.customer_schema import CustomerLogin, CustomerOut, CustomerRefresh, CustomerSignupRequest
from schemas.saved_address import SavedAddressCreateRequest, SavedAddressPatchRequest
from security.booking_access_check import require_customer_principal
from services.customer_service import (
    add_user,
    authenticate_user,
    authenticate_user_google,
    oauth,
    refresh_user_tokens_reduce_number_of_logins,
    remove_user,
    retrieve_users,
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
    revoke_other_sessions_contract,
    sign_in_customer_contract,
    sign_up_customer_contract,
    update_notification_preferences_contract,
    update_security_preferences_contract,
    update_customer_profile_contract,
)
from security.account_status_check import check_user_account_status_and_permissions
from security.auth import verify_customer_refresh_token
from security.principal import AuthPrincipal

load_dotenv()

router = APIRouter(prefix="/customers", tags=["Customers"])
customer_app_router = APIRouter(tags=["Customers"])

SUCCESS_PAGE_URL = os.getenv("SUCCESS_PAGE_URL", "http://localhost:8080/success")
ERROR_PAGE_URL = os.getenv("ERROR_PAGE_URL", "http://localhost:8080/error")


@router.get("/google/auth")
async def login_with_google_account(request: Request):
    redirect_uri = request.url_for("auth_callback_user")
    print("REDIRECT URI:", redirect_uri)
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback")
async def auth_callback_user(request: Request):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo")

    if user_info:
        print("✅ Google customer info:", user_info)
        rider = CustomerSignupRequest(
            firstName=user_info["name"],
            password="",
            lastName=user_info["given_name"],
            email=user_info["email"],
        )
        data = await authenticate_user_google(user_data=rider)
        access_token = data.access_token
        refresh_token = data.refresh_token

        success_url = f"{SUCCESS_PAGE_URL}?access_token={access_token}&refresh_token={refresh_token}"

        return RedirectResponse(
            url=success_url,
            status_code=status.HTTP_302_FOUND,
        )

    raise HTTPException(status_code=400, detail={"message": "No customer info found"})


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
async def signup_new_user(user_data: CustomerSignupRequest):
    items = await add_user(user_data=user_data)
    return items


@router.post("/login")
@document_response(message="Login successful")
async def login_user(user_data: CustomerLogin):
    items = await authenticate_user(user_data=user_data)
    return items


@router.post("/refresh")
@document_response(message="Tokens refreshed successfully")
async def refresh_user_tokens(
    user_data: CustomerRefresh,
    principal: AuthPrincipal = Depends(verify_customer_refresh_token),
):
    items = await refresh_user_tokens_reduce_number_of_logins(
        user_refresh_data=user_data,
        expired_access_token=principal.access_token_id,
    )
    return items


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
    payload: SavedAddressCreateRequest,
    principal: AuthPrincipal = Depends(require_customer_principal),
):
    return await create_my_saved_address(user_id=principal.user_id, payload=payload)


@router.patch("/me/addresses/{address_id}")
@document_response(message="Saved address updated successfully")
async def update_my_address(
    address_id: str = Path(..., description="Saved address identifier"),
    payload: SavedAddressPatchRequest = ...,
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


@router.post("/sign-in")
@document_response(message="Login successful")
async def sign_in(payload: AuthSignInRequestContract):
    return await sign_in_customer_contract(payload)


@router.post("/sign-up")
@document_response(message="Customer created successfully", status_code=status.HTTP_201_CREATED)
async def sign_up(payload: AuthSignUpRequestContract):
    return await sign_up_customer_contract(payload)


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
