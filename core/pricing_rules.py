from __future__ import annotations

from schemas.imports import AddOn, CleaningScopeItem, CleaningServices, PropertyType


BASE_SERVICE_HOURLY_MINOR: dict[CleaningServices, int] = {
    CleaningServices.STANDARD: 4500,
    CleaningServices.OFFICE: 6500,
    CleaningServices.DEEP_CLEAN: 9000,
    CleaningServices.CUSTOM: 5000,
}

ADDON_PRICE_MINOR: dict[AddOn, int] = {
    AddOn.LAUNDRY: 2500,
    AddOn.INSIDE_FRIDGE: 1800,
    AddOn.WINDOWS: 3000,
    AddOn.CABINETS: 2200,
}

CUSTOM_SQUARE_METER_RATE_MINOR: int = 55
CUSTOM_BEDROOM_RATE_MINOR: int = 1400
CUSTOM_BATHROOM_RATE_MINOR: int = 1800

CUSTOM_PROPERTY_MULTIPLIER: dict[PropertyType, float] = {
    PropertyType.APARTMENT: 1.0,
    PropertyType.HOUSE: 1.15,
    PropertyType.OFFICE: 1.25,
    PropertyType.COMMERCIAL: 1.4,
}

CUSTOM_SCOPE_PRICE_MINOR: dict[CleaningScopeItem, int] = {
    CleaningScopeItem.KITCHEN: 1500,
    CleaningScopeItem.BATHROOM: 1700,
    CleaningScopeItem.BEDROOM: 1300,
    CleaningScopeItem.LIVING_AREA: 1200,
    CleaningScopeItem.WINDOWS: 1800,
    CleaningScopeItem.APPLIANCES: 1600,
    CleaningScopeItem.FLOORS: 1100,
    CleaningScopeItem.UPHOLSTERY: 1900,
}
