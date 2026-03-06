from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
    createdAt: datetime


class AuthResponseContract(BaseModel):
    accessToken: str
    refreshToken: str | None = None
    expiresAt: datetime
    user: AuthUserContract


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
