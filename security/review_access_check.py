from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from bson import ObjectId
from fastapi import Depends, HTTPException, Path, Request, status

from core.database import db
from schemas.customer_schema import CustomerOut
from security.account_status_check import check_customer_account_status_and_permissions
from services.review_service import retrieve_review_by_review_id


@dataclass(frozen=True)
class ReviewAccessContext:
    customer_id: str
    booking_id: str
    cleaner_id: str
    review_id: str | None = None


def _record_value(record: Any, key: str) -> Any:
    if isinstance(record, dict):
        return record.get(key)
    return getattr(record, key, None)


async def _find_booking_by_id(booking_id: str) -> dict[str, Any] | None:
    filters: list[dict[str, Any]] = []
    if ObjectId.is_valid(booking_id):
        filters.append({"_id": ObjectId(booking_id)})
    filters.append({"_id": booking_id})
    filters.append({"id": booking_id})

    for filter_dict in filters:
        result = await db.bookings.find_one(filter_dict)
        if result is not None:
            return result
    return None


async def _ensure_booking_belongs_to_customer(
    *, booking_id: str, customer_id: str
) -> tuple[str, str]:
    booking = await _find_booking_by_id(booking_id=booking_id)
    if booking is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booking not found",
        )

    booking_customer_id = _record_value(booking, "customer_id")
    if booking_customer_id != customer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to review this booking",
        )

    cleaner_id = _record_value(booking, "cleaner_id")
    if not cleaner_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Booking has no cleaner_id",
        )

    return str(booking_customer_id), str(cleaner_id)


async def _find_customer_review_for_booking(
    *, customer_id: str, booking_id: str
) -> Any | None:
    return await db.reviews.find_one(
        {
            "customer_id": customer_id,
            "booking_id": booking_id,
        }
    )


async def require_review_create_access(
    request: Request,
    customer: CustomerOut = Depends(check_customer_account_status_and_permissions),
) -> ReviewAccessContext:
    customer_id = str(customer.id or "")
    if not customer_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid customer identity",
        )

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid request body",
        )

    if not isinstance(body, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid request body format",
        )

    payload_customer_id = body.get("customer_id")
    booking_id = body.get("booking_id")

    if not isinstance(payload_customer_id, str) or not payload_customer_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="customer_id is required",
        )
    if not isinstance(booking_id, str) or not booking_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="booking_id is required",
        )

    _, cleaner_id = await _ensure_booking_belongs_to_customer(
        booking_id=booking_id,
        customer_id=customer_id,
    )

    if payload_customer_id != customer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="customer_id must match the authenticated customer",
        )

    existing_review = await _find_customer_review_for_booking(
        customer_id=customer_id,
        booking_id=booking_id,
    )
    if existing_review is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reviewed this booking",
        )

    return ReviewAccessContext(
        customer_id=customer_id,
        booking_id=booking_id,
        cleaner_id=cleaner_id,
    )


async def _require_existing_review_access(
    *,
    review_id: str,
    customer: CustomerOut,
) -> ReviewAccessContext:
    customer_id = str(customer.id or "")
    if not customer_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid customer identity",
        )

    review = await retrieve_review_by_review_id(id=review_id)
    _, cleaner_id = await _ensure_booking_belongs_to_customer(
        booking_id=review.booking_id,
        customer_id=customer_id,
    )
    if review.customer_id != customer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only modify your own review",
        )

    return ReviewAccessContext(
        customer_id=customer_id,
        booking_id=review.booking_id,
        cleaner_id=cleaner_id,
        review_id=review_id,
    )


async def require_review_update_access(
    id: str = Path(..., description="ID of the review to update"),
    customer: CustomerOut = Depends(check_customer_account_status_and_permissions),
) -> ReviewAccessContext:
    return await _require_existing_review_access(review_id=id, customer=customer)


async def require_review_delete_access(
    id: str = Path(..., description="ID of the review to delete"),
    customer: CustomerOut = Depends(check_customer_account_status_and_permissions),
) -> ReviewAccessContext:
    return await _require_existing_review_access(review_id=id, customer=customer)
