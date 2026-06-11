import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import {
  AllowedCountriesOut,
  AutocompleteOut,
  AutocompleteQuery,
  DetailsQuery,
  PlaceDetails,
  ReverseGeocodeQuery,
  SearchHistoryOut,
  SearchResultCreate,
  SearchResultOut,
} from '@/server/schemas/place'
import * as placeService from '@/server/services/place-service'

/**
 * /v1/places — Google Maps autocomplete/details/reverse-geocode + search history.
 * Mounted under /api/v1/places (see server/app.ts).
 * All routes are customer-guarded except /allowed-countries which is open.
 * See: docs/migration/07-domain-endpoints.md (/v1/places)
 */

export const places = createRouter()

const authErrs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

// --- GET /allowed-countries (open) ------------------------------------------
places.openapi(
  createRoute({
    method: 'get',
    path: '/allowed-countries',
    tags: ['Places'],
    responses: {
      200: { description: 'Allowed countries', content: { 'application/json': { schema: envelopeOf(AllowedCountriesOut) } } },
    },
  }),
  (c) => c.json(ok(c, 'Allowed countries fetched successfully', placeService.allowedCountries()), 200),
)

// --- customer-guarded routes -------------------------------------------------
places.use('/autocomplete', requireCustomer())
places.use('/details', requireCustomer())
places.use('/search-results', requireCustomer())
places.use('/search-history', requireCustomer())
places.use('/reverse-geocode', requireCustomer())

// GET /autocomplete
places.openapi(
  createRoute({
    method: 'get',
    path: '/autocomplete',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    request: { query: AutocompleteQuery },
    responses: {
      200: { description: 'Predictions', content: { 'application/json': { schema: envelopeOf(AutocompleteOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const predictions = await placeService.autocomplete(c.req.valid('query'))
    return c.json(ok(c, 'Autocomplete results fetched successfully', predictions), 200)
  },
)

// GET /details
places.openapi(
  createRoute({
    method: 'get',
    path: '/details',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    request: { query: DetailsQuery },
    responses: {
      200: { description: 'Place details', content: { 'application/json': { schema: envelopeOf(PlaceDetails) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const result = await placeService.details(c.req.valid('query'))
    return c.json(ok(c, 'Place details fetched successfully', result), 200)
  },
)

// GET /reverse-geocode
places.openapi(
  createRoute({
    method: 'get',
    path: '/reverse-geocode',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    request: { query: ReverseGeocodeQuery },
    responses: {
      200: { description: 'Reverse-geocode result', content: { 'application/json': { schema: envelopeOf(PlaceDetails.nullable()) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const result = await placeService.reverseGeocode(c.req.valid('query'))
    return c.json(ok(c, 'Reverse-geocode result fetched successfully', result), 200)
  },
)

// POST /search-results
places.openapi(
  createRoute({
    method: 'post',
    path: '/search-results',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: SearchResultCreate } } } },
    responses: {
      201: { description: 'Search result saved', content: { 'application/json': { schema: envelopeOf(SearchResultOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const saved = await placeService.saveSearchResult(p.userId, c.req.valid('json'))
    return c.json(ok(c, 'Search result saved successfully', saved), 201)
  },
)

// GET /search-results
places.openapi(
  createRoute({
    method: 'get',
    path: '/search-results',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Search history', content: { 'application/json': { schema: envelopeOf(SearchHistoryOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const history = await placeService.listSearchHistory(p.userId)
    return c.json(ok(c, 'Search history fetched successfully', history), 200)
  },
)

// GET /search-history (alias of /search-results)
places.openapi(
  createRoute({
    method: 'get',
    path: '/search-history',
    tags: ['Places'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Search history', content: { 'application/json': { schema: envelopeOf(SearchHistoryOut) } } },
      ...authErrs,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const history = await placeService.listSearchHistory(p.userId)
    return c.json(ok(c, 'Search history fetched successfully', history), 200)
  },
)
