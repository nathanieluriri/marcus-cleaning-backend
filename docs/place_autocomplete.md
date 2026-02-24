# Places Autocomplete API Guide

This module exposes Google-backed place search APIs with Redis-first caching.

## Prerequisites

- `GOOGLE_MAPS_API_KEY` must be configured.
- The key must have Google Places API and Geocoding API enabled.
- Redis connection must be configured (`REDIS_HOST`, `REDIS_PORT`, optional username/password).

## Cache Policy

- Cache TTL for all place endpoints: **15 days** (`1296000` seconds).
- Cache-first strategy is always used before calling Google APIs.

Cache keys:

- `places:autocomplete:{country_or_any}:{normalized_input}`
- `places:details:{place_id}`
- `places:reverse:{lat_6dp}:{lng_6dp}:{country_or_any}`

## Endpoints

### `GET /v1/places/allowed-countries`

Returns allowed ISO country codes from `core/countries.py`.

### `GET /v1/places/autocomplete`

Auth:

- Bearer token required.

Query params:

- `input` (required)
- `country` (optional, 2-letter country code)

Returns enriched place suggestions in `PlaceOut` shape:

- `place_id`
- `name`
- `formatted_address`
- `longitude`
- `latitude`
- `description`

### `GET /v1/places/details`

Auth:

- Bearer token required.

Query params:

- `place_id` (required)

Returns one `PlaceOut` item.

### `POST /v1/places/search-results`

Auth:

- Bearer token required.

Body:

- `search_input` (string)
- `place` (`PlaceOut`)

Saves one selected autocomplete result for the authenticated user.

### `GET /v1/places/search-results`

Auth:

- Bearer token required.

Query params:

- `start` (default `0`)
- `stop` (default `20`, max `100`)

Returns saved search history for the authenticated user only.

### `GET /v1/places/reverse-geocode`

Query params:

- `lat` (required float, `-90..90`)
- `lng` (required float, `-180..180`)
- `country` (optional, 2-letter country code)

Returns one `PlaceOut` item derived from best reverse-geocode result.

## Provider Status Mapping

- `OK`: normal success path.
- `ZERO_RESULTS`:
  - autocomplete: returns `[]`
  - details/reverse-geocode: returns `404`
- `INVALID_REQUEST`: `400`
- `REQUEST_DENIED`: `403`
- `OVER_QUERY_LIMIT`: `429`
- anything else: `502`

## Current Location Flow

1. Client gets device coordinates (`lat`, `lng`).
2. Client calls `GET /v1/places/reverse-geocode`.
3. Backend returns `place_id` and display-ready fields.
4. Client reuses that `place_id` in downstream booking/fare APIs.
