import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import { CustomerOut, PreferredLanguage } from '@/server/schemas/customer'
import { SavedAddressOut, SavedAddressCreate, SavedAddressUpdate } from '@/server/schemas/saved-address'
import * as savedAddressService from '@/server/services/saved-address-service'
import * as settingsService from '@/server/services/customer-settings-service'
import * as sessionRepo from '@/server/repositories/session-repo'

/**
 * /v1/customers — profile / addresses / settings / language slice.
 *
 * SEPARATE router from the auth slice (server/routes/customers.ts). Both mount
 * under /api/v1/customers; the base path is intentionally shared (see app.ts).
 *
 * Auth endpoints (signup/login/refresh) and the shared session controls
 * (/sessions/revoke-others|all|logout) live elsewhere and are NOT redefined here.
 *
 * See: docs/migration/07-domain-endpoints.md (`/v1/customers`).
 */

export const customerExtras = createRouter()

// --- shared error documentation ---
const authErr = { 401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } } }
const notFoundErr = { 404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } } }
const validationErr = { 422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } } }

// --- request schemas (slice-local; the customer auth schemas live in schemas/customer.ts) ---
const ProfileUpdateBody = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phoneNumber: z.string().nullable().optional(),
    avatarDocumentId: z.string().nullable().optional(),
  })
  .openapi('CustomerProfileUpdate')

const LanguageBody = z.object({ language: PreferredLanguage }).openapi('CustomerLanguageUpdate')
const LanguageData = z.object({ language: PreferredLanguage }).openapi('CustomerLanguageResult')

// Settings sections are open-ended preference maps; accept arbitrary boolean/string prefs.
const NotificationsBody = z
  .object({ push: z.boolean().optional(), email: z.boolean().optional(), sms: z.boolean().optional() })
  .passthrough()
  .openapi('CustomerNotificationPrefs')
const SecurityBody = z
  .object({ twoFactorEnabled: z.boolean().optional() })
  .passthrough()
  .openapi('CustomerSecurityPrefs')
const PrivacyBody = z
  .object({ profileVisible: z.boolean().optional(), shareUsageData: z.boolean().optional() })
  .passthrough()
  .openapi('CustomerPrivacyPrefs')

const SettingsData = z.record(z.string(), z.unknown()).openapi('CustomerSettings')
const DeletedData = z.object({ deleted: z.boolean() }).openapi('CustomerAddressDeleted')
const RevokedData = z.object({ revoked: z.number().int() }).openapi('CustomerSessionRevoked')
const AddressListData = z.array(SavedAddressOut).openapi('SavedAddressList')

// --- guards: every route in this slice is customer-authenticated ---
customerExtras.use('/me', requireCustomer())
customerExtras.use('/me/*', requireCustomer())
customerExtras.use('/settings', requireCustomer())
customerExtras.use('/settings/*', requireCustomer())
customerExtras.use('/profile/*', requireCustomer())

const TAG = 'Customers'

// =====================================================================
// Profile  (PATCH /me  +  GET/PATCH /profile/me aliases)
// =====================================================================
const addressIdParam = z.object({ address_id: z.string().openapi({ param: { name: 'address_id', in: 'path' } }) })
const sessionIdParam = z.object({ session_id: z.string().openapi({ param: { name: 'session_id', in: 'path' } }) })

function registerProfileUpdate(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'patch',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      request: { body: { content: { 'application/json': { schema: ProfileUpdateBody } } } },
      responses: {
        200: { description: 'Profile updated', content: { 'application/json': { schema: envelopeOf(CustomerOut) } } },
        ...authErr,
        ...notFoundErr,
        ...validationErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const updated = await settingsService.updateProfile(p.userId, c.req.valid('json'))
      return c.json(ok(c, 'Profile updated successfully', updated), 200)
    },
  )
}

function registerProfileGet(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'get',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Profile', content: { 'application/json': { schema: envelopeOf(CustomerOut) } } },
        ...authErr,
        ...notFoundErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const profile = await settingsService.getProfile(p.userId)
      return c.json(ok(c, 'Profile retrieved successfully', profile), 200)
    },
  )
}

registerProfileUpdate('/me')
registerProfileGet('/profile/me')
registerProfileUpdate('/profile/me')

// =====================================================================
// Addresses  (/me/addresses + /profile/addresses aliases)
// =====================================================================
function registerAddressList(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'get',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Saved addresses', content: { 'application/json': { schema: envelopeOf(AddressListData) } } },
        ...authErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const addresses = await savedAddressService.list(p.userId)
      return c.json(ok(c, 'Addresses retrieved successfully', addresses), 200)
    },
  )
}

function registerAddressCreate(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'post',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      request: { body: { content: { 'application/json': { schema: SavedAddressCreate } } } },
      responses: {
        201: { description: 'Address created', content: { 'application/json': { schema: envelopeOf(SavedAddressOut) } } },
        ...authErr,
        ...validationErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const created = await savedAddressService.create(p.userId, c.req.valid('json'))
      return c.json(ok(c, 'Address created successfully', created), 201)
    },
  )
}

function registerAddressUpdate(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'patch',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      request: {
        params: addressIdParam,
        body: { content: { 'application/json': { schema: SavedAddressUpdate } } },
      },
      responses: {
        200: { description: 'Address updated', content: { 'application/json': { schema: envelopeOf(SavedAddressOut) } } },
        ...authErr,
        ...notFoundErr,
        ...validationErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const { address_id } = c.req.valid('param')
      const updated = await savedAddressService.update(p.userId, address_id, c.req.valid('json'))
      return c.json(ok(c, 'Address updated successfully', updated), 200)
    },
  )
}

function registerAddressDelete(path: string) {
  customerExtras.openapi(
    createRoute({
      method: 'delete',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      request: { params: addressIdParam },
      responses: {
        200: { description: 'Address deleted', content: { 'application/json': { schema: envelopeOf(DeletedData) } } },
        ...authErr,
        ...notFoundErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const { address_id } = c.req.valid('param')
      const result = await savedAddressService.remove(p.userId, address_id)
      return c.json(ok(c, 'Address deleted successfully', result), 200)
    },
  )
}

registerAddressList('/me/addresses')
registerAddressCreate('/me/addresses')
registerAddressUpdate('/me/addresses/{address_id}')
registerAddressDelete('/me/addresses/{address_id}')

// POST /me/addresses/{address_id}/set-default
customerExtras.openapi(
  createRoute({
    method: 'post',
    path: '/me/addresses/{address_id}/set-default',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: addressIdParam },
    responses: {
      200: { description: 'Default address set', content: { 'application/json': { schema: envelopeOf(SavedAddressOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { address_id } = c.req.valid('param')
    const updated = await savedAddressService.setDefault(p.userId, address_id)
    return c.json(ok(c, 'Default address set successfully', updated), 200)
  },
)

// Address aliases under /profile
registerAddressList('/profile/addresses')
registerAddressCreate('/profile/addresses')
registerAddressUpdate('/profile/addresses/{address_id}')
registerAddressDelete('/profile/addresses/{address_id}')

// =====================================================================
// Language  (GET/PATCH /me/language)
// =====================================================================
customerExtras.openapi(
  createRoute({
    method: 'get',
    path: '/me/language',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Preferred language', content: { 'application/json': { schema: envelopeOf(LanguageData) } } },
      ...authErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const result = await settingsService.getLanguage(p.userId)
    return c.json(ok(c, 'Language retrieved successfully', result), 200)
  },
)

customerExtras.openapi(
  createRoute({
    method: 'patch',
    path: '/me/language',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: LanguageBody } } } },
    responses: {
      200: { description: 'Language updated', content: { 'application/json': { schema: envelopeOf(LanguageData) } } },
      ...authErr,
      ...validationErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { language } = c.req.valid('json')
    const result = await settingsService.setLanguage(p.userId, language)
    return c.json(ok(c, 'Language updated successfully', result), 200)
  },
)

// =====================================================================
// Settings
// =====================================================================
customerExtras.openapi(
  createRoute({
    method: 'get',
    path: '/settings',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Settings', content: { 'application/json': { schema: envelopeOf(SettingsData) } } },
      ...authErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const settings = await settingsService.getSettings(p.userId)
    return c.json(ok(c, 'Settings retrieved successfully', settings), 200)
  },
)

function registerSettingsPatch(
  path: string,
  schema: z.ZodTypeAny,
  handler: (customerId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  customerExtras.openapi(
    createRoute({
      method: 'patch',
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      request: { body: { content: { 'application/json': { schema } } } },
      responses: {
        200: { description: 'Settings updated', content: { 'application/json': { schema: envelopeOf(SettingsData) } } },
        ...authErr,
        ...validationErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const patch = c.req.valid('json') as Record<string, unknown>
      const settings = await handler(p.userId, patch)
      return c.json(ok(c, 'Settings updated successfully', settings), 200)
    },
  )
}

registerSettingsPatch('/settings/notifications', NotificationsBody, settingsService.patchNotifications)
registerSettingsPatch('/settings/security', SecurityBody, settingsService.patchSecurity)
registerSettingsPatch('/settings/privacy', PrivacyBody, settingsService.patchPrivacy)

// --- account lifecycle ---
customerExtras.openapi(
  createRoute({
    method: 'post',
    path: '/settings/account/deactivate',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Account deactivated', content: { 'application/json': { schema: envelopeOf(CustomerOut) } } },
      ...authErr,
      ...notFoundErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const updated = await settingsService.deactivateAccount(p.userId)
    return c.json(ok(c, 'Account deactivated successfully', updated), 200)
  },
)

function registerAccountDelete(method: 'post' | 'delete', path: string) {
  customerExtras.openapi(
    createRoute({
      method,
      path,
      tags: [TAG],
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'Account deleted', content: { 'application/json': { schema: envelopeOf(CustomerOut) } } },
        ...authErr,
        ...notFoundErr,
      },
    }),
    async (c) => {
      const p = principalOf(c)
      const updated = await settingsService.deleteAccount(p.userId)
      return c.json(ok(c, 'Account deleted successfully', updated), 200)
    },
  )
}

registerAccountDelete('post', '/settings/account/delete')
registerAccountDelete('delete', '/settings/account')

// DELETE /settings/security/sessions/{session_id} — targeted session revoke
customerExtras.openapi(
  createRoute({
    method: 'delete',
    path: '/settings/security/sessions/{session_id}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: sessionIdParam },
    responses: {
      200: { description: 'Session revoked', content: { 'application/json': { schema: envelopeOf(RevokedData) } } },
      ...authErr,
    },
  }),
  async (c) => {
    const p = principalOf(c)
    const { session_id } = c.req.valid('param')
    const revoked = await sessionRepo.revokeSession(p.userId, session_id, new Date())
    return c.json(ok(c, 'Session revoked successfully', { revoked }), 200)
  },
)

// =====================================================================
// TODO: payment-method aliases (see /v1/payments/methods) — owned by the
// payments domain agent:
//   GET    /profile/payment-methods
//   POST   /profile/payment-methods
//   PATCH  /profile/payment-methods/{payment_method_id}
//   DELETE /profile/payment-methods/{payment_method_id}
//
// TODO: cross-domain contract aliases — NOT implemented in this slice:
//   GET  /home                                       (customer-app home)
//   GET  /bookings/services/{service_id}/extras
//   GET  /bookings/cleaners
//   GET  /bookings/cleaners/{cleaner_id}
//   GET  /bookings/cleaners/{cleaner_id}/reviews
//   POST /bookings/create
// =====================================================================
