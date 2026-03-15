from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class AppActionType(str, Enum):
    ROUTE = "route"
    DEEPLINK = "deeplink"
    BOTTOM_SHEET = "bottom_sheet"
    MODAL = "modal"
    EXTERNAL_URL = "external_url"


class NotificationTypeContract(str, Enum):
    BOOKING_CONFIRMED = "booking_confirmed"
    CLEANER_ARRIVING = "cleaner_arriving"
    SPECIAL_OFFER = "special_offer"
    RATING_REQUEST = "rating_request"
    SERVICE_UPDATE = "service_update"
    PAYMENT_RECEIPT = "payment_receipt"
    REMINDER = "reminder"


class ReviewTimePeriodContract(str, Enum):
    ALL = "all"
    LAST_30_DAYS = "last30Days"
    LAST_90_DAYS = "last90Days"
    LAST_YEAR = "lastYear"


class AccountLifecycleActionContract(str, Enum):
    DEACTIVATE = "deactivate"
    DELETE = "delete"


class BookingDurationTypeContract(str, Enum):
    PRESET = "preset"
    CUSTOM = "custom"


class BookingDraftStatusContract(str, Enum):
    DRAFT = "draft"
    PENDING_CONFIRMATION = "pendingConfirmation"
    CONFIRMED = "confirmed"


class ActionContract(BaseModel):
    type: AppActionType
    value: str
    label: str | None = None


class AuthSignInRequestContract(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class AuthSignUpRequestContract(BaseModel):
    fullName: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=1)


class AuthPasswordResetRequestContract(BaseModel):
    email: EmailStr


class AuthUserContract(BaseModel):
    id: str
    fullName: str
    email: EmailStr
    phoneNumber: str | None = None
    avatarUrl: str | None = None
    createdAt: datetime


class AuthResponseContract(BaseModel):
    accessToken: str
    refreshToken: str | None = None
    expiresAt: datetime
    user: AuthUserContract


class CustomerProfileEditRequestContract(BaseModel):
    fullName: str | None = None
    phoneNumber: str | None = Field(
        default=None,
        pattern=r"^\+[1-9]\d{1,14}$",
    )
    avatarDocumentId: str | None = None

    model_config = ConfigDict(extra="forbid")


class CustomerProfileContract(BaseModel):
    id: str
    fullName: str
    email: EmailStr
    phoneNumber: str | None = None
    avatarDocumentId: str | None = None
    avatarUrl: str | None = None
    createdAt: datetime


class LocationItemContract(BaseModel):
    id: str
    label: str
    addressLine: str
    hint: str | None = None


class OfferItemContract(BaseModel):
    id: str
    theme: str
    badge: str
    headline: str
    enabled: bool
    isLoading: bool
    cta: ActionContract
    action: ActionContract


class ServicesGridItemContract(BaseModel):
    id: str
    title: str
    subtitle: str
    icon: str
    enabled: bool
    action: ActionContract


class RecentBookingItemContract(BaseModel):
    id: str
    name: str
    lastBookedLabel: str
    rating: float
    avatarUrl: str | None = None
    enabled: bool
    secondaryActionEnabled: bool
    isLoading: bool
    action: ActionContract
    secondaryAction: ActionContract


class HomeSectionContract(BaseModel):
    type: str
    title: str
    isLoading: bool
    action: ActionContract | None = None
    items: list[Any]


class HomePayloadContract(BaseModel):
    screen: str = "home"
    user: dict[str, Any]
    header: dict[str, Any]
    location: dict[str, Any]
    sections: list[HomeSectionContract]
    nav: dict[str, Any]


class BookingExtraContract(BaseModel):
    id: str
    title: str
    price: float
    isAvailable: bool


class CleanerCardContract(BaseModel):
    id: str
    name: str
    rating: float
    jobsDone: int
    hourlyRate: float
    isVerified: bool
    avatarUrl: str | None = None
    roleLabel: str
    yearsExperience: int
    bookingsCount: int
    heroImageUrl: str | None = None


class CleanerCertificationContract(BaseModel):
    id: str
    label: str
    icon: str


class CleanerReviewContract(BaseModel):
    id: str
    reviewerName: str
    rating: int
    text: str
    timestamp: datetime
    avatarUrl: str | None = None


class CleanerProfileContract(BaseModel):
    id: str
    name: str
    yearsExperience: int
    roleLabel: str
    heroImageUrl: str | None = None
    rating: float
    reviewsCount: int
    bookingsCount: int
    hourlyRate: float
    certifications: list[CleanerCertificationContract]
    about: str
    reviewPreview: list[CleanerReviewContract]


class CleanerReviewsPageContract(BaseModel):
    items: list[CleanerReviewContract]
    nextCursor: str | None = None


class BookingServiceContract(BaseModel):
    id: str
    title: str
    basePrice: float


class BookingDurationContract(BaseModel):
    type: BookingDurationTypeContract
    hours: int = Field(ge=0)
    minutes: int = Field(ge=0, le=59)


class BookingLocationContract(BaseModel):
    id: str
    label: str
    address: str


class BookingScheduleContract(BaseModel):
    date: datetime
    timeWindow: str


class BookingPricingContract(BaseModel):
    base: float
    extras: float
    fees: float
    total: float
    currency: str


class BookingCreateRequestContract(BaseModel):
    service: BookingServiceContract
    duration: BookingDurationContract
    availableExtras: list[BookingExtraContract]
    selectedExtraIds: list[str]
    location: BookingLocationContract
    schedule: BookingScheduleContract
    cleaner: CleanerCardContract
    pricing: BookingPricingContract
    status: BookingDraftStatusContract


class BookingCreateResponseContract(BaseModel):
    bookingId: str


class NotificationItemContract(BaseModel):
    id: str
    type: NotificationTypeContract
    title: str
    message: str
    timestamp: datetime
    isRead: bool
    action: ActionContract | None = None


class NotificationListQuery(BaseModel):
    page: int = Field(default=0, ge=0)
    pageSize: int = Field(default=20, ge=1, le=100)


class QuietHoursContract(BaseModel):
    enabled: bool
    startTime: str
    endTime: str
    timezone: str

    model_config = ConfigDict(extra="forbid")

    @field_validator("startTime", "endTime")
    @classmethod
    def validate_hhmm(cls, value: str) -> str:
        if len(value) != 5 or value[2] != ":":
            raise ValueError("time must be in HH:MM format")
        hour, minute = value.split(":")
        if not hour.isdigit() or not minute.isdigit():
            raise ValueError("time must be in HH:MM format")
        if int(hour) < 0 or int(hour) > 23 or int(minute) < 0 or int(minute) > 59:
            raise ValueError("time must be in HH:MM format")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except Exception as err:
            raise ValueError("timezone must be a valid IANA timezone") from err
        return value


class QuietHoursPatchContract(BaseModel):
    enabled: bool | None = None
    startTime: str | None = None
    endTime: str | None = None
    timezone: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("startTime", "endTime")
    @classmethod
    def validate_optional_hhmm(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if len(value) != 5 or value[2] != ":":
            raise ValueError("time must be in HH:MM format")
        hour, minute = value.split(":")
        if not hour.isdigit() or not minute.isdigit():
            raise ValueError("time must be in HH:MM format")
        if int(hour) < 0 or int(hour) > 23 or int(minute) < 0 or int(minute) > 59:
            raise ValueError("time must be in HH:MM format")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_optional_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return value
        try:
            ZoneInfo(value)
        except Exception as err:
            raise ValueError("timezone must be a valid IANA timezone") from err
        return value


class NotificationChannelsContract(BaseModel):
    push: bool
    email: bool
    sms: bool

    model_config = ConfigDict(extra="forbid")


class NotificationChannelsPatchContract(BaseModel):
    push: bool | None = None
    email: bool | None = None
    sms: bool | None = None

    model_config = ConfigDict(extra="forbid")


class NotificationPreferencesContract(BaseModel):
    enabled: bool
    channels: NotificationChannelsContract
    quietHours: QuietHoursContract

    model_config = ConfigDict(extra="forbid")


class NotificationPreferencesPatchContract(BaseModel):
    enabled: bool | None = None
    channels: NotificationChannelsPatchContract | None = None
    quietHours: QuietHoursPatchContract | None = None

    model_config = ConfigDict(extra="forbid")


class SecurityPreferencesContract(BaseModel):
    biometricLoginEnabled: bool
    twoFactorEnabled: bool

    model_config = ConfigDict(extra="forbid")


class SecurityPreferencesPatchContract(BaseModel):
    biometricLoginEnabled: bool | None = None
    twoFactorEnabled: bool | None = None

    model_config = ConfigDict(extra="forbid")


class SessionControlContract(BaseModel):
    activeSessionCount: int = Field(ge=0, default=1)
    revocableSessionCount: int = Field(ge=0, default=0)
    canRevokeOtherSessions: bool = False

    model_config = ConfigDict(extra="forbid")


class PendingAccountLifecycleActionContract(BaseModel):
    action: AccountLifecycleActionContract
    effectiveAt: datetime
    status: str = "pending"

    model_config = ConfigDict(extra="forbid")


class AccountLifecycleSettingsContract(BaseModel):
    pendingAction: PendingAccountLifecycleActionContract | None = None

    model_config = ConfigDict(extra="forbid")


class RevokeOtherSessionsResponseContract(BaseModel):
    revokedAccessSessions: int = Field(ge=0, default=0)
    revokedRefreshSessions: int = Field(ge=0, default=0)

    model_config = ConfigDict(extra="forbid")


class AccountDeactivateRequestContract(BaseModel):
    effectiveAt: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class AccountDeleteRequestContract(BaseModel):
    confirmationText: str = Field(min_length=1)
    effectiveAt: datetime | None = None

    model_config = ConfigDict(extra="forbid")


class AccountLifecycleActionResponseContract(BaseModel):
    accepted: bool
    scheduled: bool
    action: AccountLifecycleActionContract
    effectiveAt: datetime

    model_config = ConfigDict(extra="forbid")


class SettingsSnapshotContract(BaseModel):
    notifications: NotificationPreferencesContract
    privacy: dict[str, Any] = Field(default_factory=dict)
    security: SecurityPreferencesContract
    sessions: SessionControlContract = Field(default_factory=SessionControlContract)
    accountLifecycle: AccountLifecycleSettingsContract = Field(default_factory=AccountLifecycleSettingsContract)
    legal: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class CleanerFiltersContract(BaseModel):
    minRating: float | None = Field(default=None, ge=0.0, le=5.0)
    maxHourlyRate: float | None = Field(default=None, gt=0)
    onlyAvailableNow: bool | None = None


class CleanerReviewFiltersContract(BaseModel):
    cursor: str | None = None
    pageSize: int = Field(default=10, ge=1, le=50)
    stars: int | None = Field(default=None, ge=1, le=5)
    timePeriod: ReviewTimePeriodContract = ReviewTimePeriodContract.ALL


class ContractResponseMeta(BaseModel):
    generatedAt: datetime

    model_config = ConfigDict(extra="forbid")
