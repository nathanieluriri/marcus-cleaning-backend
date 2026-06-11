import { getSettings } from '@/server/core/settings'
import { AppError, badRequest } from '@/server/core/errors'
import * as searchRepo from '@/server/repositories/autocomplete-search-result-repo'
import type {
  AllowedCountry,
  AutocompleteQuery,
  DetailsQuery,
  PlaceDetails,
  PlacePrediction,
  ReverseGeocodeQuery,
  SearchResultCreate,
  SearchResultOut,
} from '@/server/schemas/place'

/**
 * Place business logic — Google Maps Platform via fetch + per-user search
 * history. No HTTP/Hono types here so cron/tests can reuse it.
 * Ported from the Python place service.
 * See: docs/migration/07-domain-endpoints.md (/v1/places)
 *
 * Google endpoints used (legacy Maps web-service APIs, JSON):
 *  - Place Autocomplete:  https://maps.googleapis.com/maps/api/place/autocomplete/json
 *  - Place Details:       https://maps.googleapis.com/maps/api/place/details/json
 *  - Reverse Geocoding:   https://maps.googleapis.com/maps/api/geocode/json
 */

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api'

interface GoogleComponent {
  long_name?: string
  short_name?: string
  types?: string[]
}
interface GoogleResult {
  place_id?: string
  description?: string
  formatted_address?: string
  geometry?: { location?: { lat?: number; lng?: number } }
  address_components?: GoogleComponent[]
  structured_formatting?: { main_text?: string; secondary_text?: string }
}
interface GoogleResponse {
  status?: string
  error_message?: string
  predictions?: GoogleResult[]
  result?: GoogleResult
  results?: GoogleResult[]
}

/**
 * Allowed operating countries (small constant list). The Python service kept an
 * equivalent allow-list; adjust here if the business expands coverage.
 */
const ALLOWED_COUNTRIES: AllowedCountry[] = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
]

function apiKey(): string {
  const key = getSettings().GOOGLE_MAPS_API_KEY
  if (!key) throw new AppError(503, 'PLACES_UNAVAILABLE', 'Places provider is not configured')
  return key
}

/** Module-level reused fetch (no per-call lifecycle / no agent management). */
async function googleGet(path: string, params: Record<string, string | undefined>): Promise<GoogleResponse> {
  const url = new URL(`${GOOGLE_BASE}/${path}`)
  url.searchParams.set('key', apiKey())
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, v)
  }
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw new AppError(502, 'PLACES_UPSTREAM_ERROR', 'Places provider request failed', {
      httpStatus: res.status,
    })
  }
  const body = (await res.json()) as GoogleResponse
  // Google returns 200 with a `status` field; OK/ZERO_RESULTS are non-errors.
  if (body.status && body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw new AppError(502, 'PLACES_UPSTREAM_ERROR', body.error_message || `Places provider: ${body.status}`, {
      status: body.status,
    })
  }
  return body
}

export function allowedCountries(): AllowedCountry[] {
  return ALLOWED_COUNTRIES
}

export async function autocomplete(q: AutocompleteQuery): Promise<PlacePrediction[]> {
  const body = await googleGet('place/autocomplete/json', {
    input: q.input,
    components: q.country ? `country:${q.country.toLowerCase()}` : undefined,
    sessiontoken: q.sessionToken,
  })
  const predictions: GoogleResult[] = Array.isArray(body.predictions) ? body.predictions : []
  return predictions.map((p) => ({
    placeId: String(p.place_id),
    description: String(p.description ?? ''),
    mainText: p.structured_formatting?.main_text ?? null,
    secondaryText: p.structured_formatting?.secondary_text ?? null,
  }))
}

export async function details(q: DetailsQuery): Promise<PlaceDetails> {
  const body = await googleGet('place/details/json', {
    place_id: q.placeId,
    sessiontoken: q.sessionToken,
    fields: 'place_id,formatted_address,geometry/location,address_components',
  })
  const r = body.result
  if (!r) throw badRequest('Place not found', { placeId: q.placeId })
  return mapDetails(r)
}

export async function reverseGeocode(q: ReverseGeocodeQuery): Promise<PlaceDetails | null> {
  const body = await googleGet('geocode/json', {
    latlng: `${q.latitude},${q.longitude}`,
  })
  const first: GoogleResult | null = Array.isArray(body.results) ? body.results[0] ?? null : null
  if (!first) return null
  return mapDetails(first)
}

/** Map a Google place/geocode result into our PlaceDetails shape. */
function mapDetails(r: GoogleResult): PlaceDetails {
  const components: GoogleComponent[] = Array.isArray(r.address_components) ? r.address_components : []
  const find = (type: string) => components.find((c) => Array.isArray(c.types) && c.types.includes(type))
  const country = find('country') as GoogleComponent | undefined
  const city = (find('locality') ?? find('administrative_area_level_2') ?? find('administrative_area_level_1')) as
    | GoogleComponent
    | undefined
  const postal = find('postal_code')
  const loc = r.geometry?.location
  return {
    placeId: String(r.place_id ?? ''),
    formattedAddress: r.formatted_address ?? null,
    latitude: typeof loc?.lat === 'number' ? loc.lat : null,
    longitude: typeof loc?.lng === 'number' ? loc.lng : null,
    country: country?.long_name ?? null,
    countryCode: country?.short_name ?? null,
    city: city?.long_name ?? null,
    postalCode: postal?.long_name ?? null,
  }
}

// --- search history ----------------------------------------------------------

export async function saveSearchResult(userId: string, payload: SearchResultCreate): Promise<SearchResultOut> {
  return searchRepo.saveSearchResult({
    userId,
    placeId: payload.placeId,
    description: payload.description,
    mainText: payload.mainText ?? null,
    secondaryText: payload.secondaryText ?? null,
    dateCreated: Math.floor(Date.now() / 1000),
  })
}

export async function listSearchHistory(userId: string): Promise<SearchResultOut[]> {
  return searchRepo.listSearchHistory(userId)
}
