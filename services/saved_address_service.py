from __future__ import annotations

import time

from core.errors import resource_not_found
from repositories.saved_address_repo import (
    clear_default_for_user,
    create_saved_address,
    delete_saved_address_for_user,
    get_most_recent_saved_address_for_user,
    get_saved_address_by_id_for_user,
    list_saved_addresses_for_user,
    mark_saved_address_as_default_for_user,
    update_saved_address_for_user,
)
from schemas.saved_address import (
    SavedAddressCreate,
    SavedAddressCreateRequest,
    SavedAddressOut,
    SavedAddressPatchRequest,
    SavedAddressUpdate,
)


def _epoch() -> int:
    return int(time.time())


async def list_my_saved_addresses(*, user_id: str, start: int = 0, stop: int = 100) -> list[SavedAddressOut]:
    return await list_saved_addresses_for_user(user_id=user_id, start=start, stop=stop)


async def create_my_saved_address(*, user_id: str, payload: SavedAddressCreateRequest) -> SavedAddressOut:
    existing = await list_saved_addresses_for_user(user_id=user_id, start=0, stop=1)
    should_default = bool(payload.isDefault) or len(existing) == 0
    if should_default:
        await clear_default_for_user(user_id=user_id)
    return await create_saved_address(
        SavedAddressCreate(
            user_id=user_id,
            label=payload.label,
            addressLine=payload.addressLine,
            place=payload.place,
            isDefault=should_default,
        )
    )


async def update_my_saved_address(*, user_id: str, address_id: str, payload: SavedAddressPatchRequest) -> SavedAddressOut:
    update_payload = SavedAddressUpdate(
        label=payload.label,
        addressLine=payload.addressLine,
        place=payload.place,
    )
    updated = await update_saved_address_for_user(
        address_id=address_id,
        user_id=user_id,
        payload=update_payload,
    )
    if updated is None:
        raise resource_not_found("SavedAddress", address_id)
    return updated


async def set_default_saved_address(*, user_id: str, address_id: str) -> SavedAddressOut:
    existing = await get_saved_address_by_id_for_user(address_id=address_id, user_id=user_id)
    if existing is None:
        raise resource_not_found("SavedAddress", address_id)
    await clear_default_for_user(user_id=user_id)
    updated = await mark_saved_address_as_default_for_user(
        address_id=address_id,
        user_id=user_id,
        last_updated=_epoch(),
    )
    if updated is None:
        raise resource_not_found("SavedAddress", address_id)
    return updated


async def delete_my_saved_address(*, user_id: str, address_id: str) -> dict[str, bool]:
    existing = await get_saved_address_by_id_for_user(address_id=address_id, user_id=user_id)
    if existing is None:
        raise resource_not_found("SavedAddress", address_id)
    deleted = await delete_saved_address_for_user(address_id=address_id, user_id=user_id)
    if not deleted:
        raise resource_not_found("SavedAddress", address_id)

    if existing.isDefault:
        fallback = await get_most_recent_saved_address_for_user(user_id=user_id)
        if fallback is not None and fallback.id:
            await clear_default_for_user(user_id=user_id)
            await mark_saved_address_as_default_for_user(
                address_id=fallback.id,
                user_id=user_id,
                last_updated=_epoch(),
            )

    return {"deleted": True}
