import { z } from '@hono/zod-openapi'

/**
 * Place domain schemas (Zod + OpenAPI).
 * Backs /v1/places — Google Maps autocomplete/details/reverse-geocode plus
 * the per-user autocomplete search history.
 * See: docs/migration/07-domain-endpoints.md (/v1/places)
 */

// --- allowed countries -------------------------------------------------------

export const AllowedCountry = z
  .object({
    code: z.string().openapi({ example: 'NG' }),
    name: z.string().openapi({ example: 'Nigeria' }),
  })
  .openapi('AllowedCountry')
export type AllowedCountry = z.infer<typeof AllowedCountry>

export const AllowedCountriesOut = z.array(AllowedCountry).openapi('AllowedCountriesOut')

// --- autocomplete ------------------------------------------------------------

export const AutocompleteQuery = z
  .object({
    input: z.string().min(1).openapi({ example: '15 Adeola Odeku' }),
    /** Optional ISO country code to bias/restrict results. */
    country: z.string().optional(),
    /** Opaque Google session token to group autocomplete + details billing. */
    sessionToken: z.string().optional(),
  })
  .openapi('PlaceAutocompleteQuery')
export type AutocompleteQuery = z.infer<typeof AutocompleteQuery>

export const PlacePrediction = z
  .object({
    placeId: z.string().openapi({ example: 'ChIJ...' }),
    description: z.string(),
    mainText: z.string().nullable().default(null),
    secondaryText: z.string().nullable().default(null),
  })
  .openapi('PlacePrediction')
export type PlacePrediction = z.infer<typeof PlacePrediction>

export const AutocompleteOut = z.array(PlacePrediction).openapi('PlaceAutocompleteOut')

// --- details -----------------------------------------------------------------

export const DetailsQuery = z
  .object({
    placeId: z.string().min(1).openapi({ example: 'ChIJ...' }),
    sessionToken: z.string().optional(),
  })
  .openapi('PlaceDetailsQuery')
export type DetailsQuery = z.infer<typeof DetailsQuery>

export const PlaceDetails = z
  .object({
    placeId: z.string(),
    formattedAddress: z.string().nullable().default(null),
    latitude: z.number().nullable().default(null),
    longitude: z.number().nullable().default(null),
    country: z.string().nullable().default(null),
    countryCode: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    postalCode: z.string().nullable().default(null),
  })
  .openapi('PlaceDetails')
export type PlaceDetails = z.infer<typeof PlaceDetails>

// --- reverse geocode ---------------------------------------------------------

export const ReverseGeocodeQuery = z
  .object({
    latitude: z.coerce.number().openapi({ example: 6.4281 }),
    longitude: z.coerce.number().openapi({ example: 3.4219 }),
  })
  .openapi('ReverseGeocodeQuery')
export type ReverseGeocodeQuery = z.infer<typeof ReverseGeocodeQuery>

// --- search-result create / history -----------------------------------------

export const SearchResultCreate = z
  .object({
    placeId: z.string().min(1).openapi({ example: 'ChIJ...' }),
    description: z.string().min(1),
    mainText: z.string().nullable().optional(),
    secondaryText: z.string().nullable().optional(),
  })
  .openapi('SearchResultCreate')
export type SearchResultCreate = z.infer<typeof SearchResultCreate>

export const SearchResultOut = z
  .object({
    id: z.string(),
    userId: z.string(),
    placeId: z.string(),
    description: z.string(),
    mainText: z.string().nullable().default(null),
    secondaryText: z.string().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
  })
  .openapi('SearchResultOut')
export type SearchResultOut = z.infer<typeof SearchResultOut>

export const SearchHistoryOut = z.array(SearchResultOut).openapi('SearchHistoryOut')
