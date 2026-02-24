from __future__ import annotations

from pydantic import BaseModel


class PlaceBase(BaseModel):
    place_id: str
    name: str
    formatted_address: str
    longitude: float
    latitude: float
    description: str | None = None


class PlaceOut(PlaceBase):
    pass
