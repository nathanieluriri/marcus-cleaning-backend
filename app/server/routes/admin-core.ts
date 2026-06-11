import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireAdmin, principalOf } from '@/server/security/guards'
import {
  LanguageOut,
  LanguageUpdate,
  ElevationRequest,
  PermissionGroupCreate,
  AccessDecision,
  PermissionTemplateUpsert,
  PermissionTemplatePreview,
  OnboardingReview,
  AdminPlaceCreate,
  AdminCreateSignup,
  AuditExportRequest,
  AdminListQuery,
  AutocompleteQuery,
  GenericObject,
  GenericList,
  RoleParam,
  RequestIdParam,
  CleanerIdParam,
  CustomerIdParamCore,
  AlertIdParam,
  ExportIdParam,
  EventIdParam,
  AdminIdParam,
} from '@/server/schemas/admin-core'
import { AdminOut } from '@/server/schemas/admin'
import * as access from '@/server/services/admin-access-service'
import * as templates from '@/server/services/role-permission-template-service'
import * as catalog from '@/server/services/permission-catalog-service'
import * as directory from '@/server/services/admin-directory-service'
import * as monitoring from '@/server/services/admin-monitoring-service'
import * as reporting from '@/server/services/admin-reporting-service'
import * as mgmt from '@/server/services/admin-management-service'

/**
 * /v1/admins — core admin endpoints that are NOT auth (auth lives in admins.ts).
 *
 * Every route is admin-guarded (`security:[{bearerAuth:[]}]` + `requireAdmin()` +
 * `principalOf(c)`) and returns the standard envelope. Heavy analytics endpoints
 * return well-shaped responses backed by services with `// TODO: real implementation`
 * markers. Mounted at /api/v1/admins in server/app.ts (alongside admins + adminFeatures).
 *
 * See: docs/migration/07-domain-endpoints.md
 */

export const adminCore = createRouter()
const TAG = 'AdminCore'

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const jsonOk = <T extends z.ZodTypeAny>(schema: T) => ({
  200: { description: 'OK', content: { 'application/json': { schema: envelopeOf(schema) } } },
  ...errs,
})

// Guard every admin-core path. Hono path-pattern guards use ':param' syntax.
const GUARDED = [
  '/profile/language',
  '/access/request-elevation',
  '/access/request-elevation/status',
  '/access/permission-groups',
  '/access/requests',
  '/access/requests/:request_id/decision',
  '/permission-templates/:role',
  '/permission-templates/:role/rollout',
  '/permission-templates/:role/preview',
  '/permission-templates/:role/rollout-impact',
  '/permissions/catalog',
  '/cleaners/:cleaner_id/onboarding-review',
  '/customers',
  '/customers/:customer_id',
  '/customers/:customer_id/places',
  '/cleaners',
  '/onboarding/queue',
  '/cleaners/:cleaner_id',
  '/users/autocomplete',
  '/signup',
  '/monitoring/overview',
  '/monitoring/auth/heatmap',
  '/monitoring/permissions/denied-top',
  '/monitoring/sessions/anomalies',
  '/monitoring/alerts/sla',
  '/monitoring/alerts',
  '/monitoring/alerts/:alert_id/read',
  '/monitoring/alerts/:alert_id/ack',
  '/monitoring/audit/export',
  '/monitoring/audit/export/:export_id',
  '/monitoring/audit/export/:export_id/download',
  '/monitoring/audit/history',
  '/monitoring/audit/history/:event_id',
  '/reports/users/summary',
  '/reports/users/signups-trend',
  '/account',
  '/:admin_id',
]
for (const p of GUARDED) adminCore.use(p, requireAdmin())

// ============================ profile language ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/profile/language', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(LanguageOut) }),
  async (c) => {
    const p = principalOf(c)
    const language = await mgmt.getLanguage(p.userId)
    return c.json(ok(c, 'Language fetched', { language }), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'patch',
    path: '/profile/language',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: LanguageUpdate } } } },
    responses: jsonOk(LanguageOut),
  }),
  async (c) => {
    const p = principalOf(c)
    const { language } = c.req.valid('json')
    const updated = await mgmt.setLanguage(p.userId, language)
    return c.json(ok(c, 'Language updated', { language: updated }), 200)
  },
)

// ============================ access / elevation ============================

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/access/request-elevation',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: ElevationRequest } } } },
    responses: { 201: { description: 'Elevation requested', content: { 'application/json': { schema: envelopeOf(GenericObject) } } }, ...errs },
  }),
  async (c) => {
    const p = principalOf(c)
    const r = await access.requestElevation({ adminId: p.userId, payload: c.req.valid('json') as Record<string, unknown> })
    return c.json(ok(c, 'Elevation requested', r), 201)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/access/request-elevation/status', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    const p = principalOf(c)
    const r = await access.elevationStatus(p.userId)
    return c.json(ok(c, 'Elevation status', r), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/access/permission-groups', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const items = await catalog.listGroups()
    return c.json(ok(c, 'Permission groups', { items, total: items.length }), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/access/permission-groups',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: PermissionGroupCreate } } } },
    responses: { 201: { description: 'Permission group created', content: { 'application/json': { schema: envelopeOf(GenericObject) } } }, ...errs },
  }),
  async (c) => {
    principalOf(c)
    const body = c.req.valid('json') as Record<string, unknown> & { name: string; permissions?: string[] }
    const created = await catalog.createGroup({ name: body.name, permissions: body.permissions ?? [], extra: body })
    return c.json(ok(c, 'Permission group created', created), 201)
  },
)

adminCore.openapi(
  createRoute({
    method: 'get',
    path: '/access/requests',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { query: AdminListQuery },
    responses: jsonOk(GenericList),
  }),
  async (c) => {
    principalOf(c)
    const { limit, skip } = c.req.valid('query')
    const r = await access.listRequests({ limit, skip })
    return c.json(ok(c, 'Access requests', r), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'patch',
    path: '/access/requests/{request_id}/decision',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RequestIdParam, body: { content: { 'application/json': { schema: AccessDecision } } } },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    const p = principalOf(c)
    const { request_id } = c.req.valid('param')
    const { decision, notes } = c.req.valid('json')
    const r = await access.decideRequest({ requestId: request_id, decision, deciderId: p.userId, notes })
    return c.json(ok(c, 'Access request decided', r), 200)
  },
)

// ============================ permission templates ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/permission-templates/{role}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: RoleParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { role } = c.req.valid('param')
    const r = await templates.getTemplate(role)
    return c.json(ok(c, 'Permission template', r), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'put',
    path: '/permission-templates/{role}',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RoleParam, body: { content: { 'application/json': { schema: PermissionTemplateUpsert } } } },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    principalOf(c)
    const { role } = c.req.valid('param')
    const r = await templates.putTemplate(role, c.req.valid('json') as Record<string, unknown>)
    return c.json(ok(c, 'Permission template saved', r), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/permission-templates/{role}/rollout',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RoleParam },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    const p = principalOf(c)
    const { role } = c.req.valid('param')
    const r = await templates.rollout({ role, triggeredBy: p.userId })
    return c.json(ok(c, 'Rollout triggered', r), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/permission-templates/{role}/preview',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RoleParam, body: { content: { 'application/json': { schema: PermissionTemplatePreview } } } },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    principalOf(c)
    const { role } = c.req.valid('param')
    const r = await templates.preview({ role, payload: c.req.valid('json') as Record<string, unknown> })
    return c.json(ok(c, 'Rollout preview', r), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'get',
    path: '/permission-templates/{role}/rollout-impact',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: RoleParam },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    principalOf(c)
    const { role } = c.req.valid('param')
    const r = await templates.rolloutImpact(role)
    return c.json(ok(c, 'Rollout impact', r), 200)
  },
)

// ============================ permissions catalog ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/permissions/catalog', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const items = catalog.getCatalog()
    return c.json(ok(c, 'Permission catalog', { items, total: items.length }), 200)
  },
)

// ============================ cleaner onboarding review ============================

adminCore.openapi(
  createRoute({
    method: 'patch',
    path: '/cleaners/{cleaner_id}/onboarding-review',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: CleanerIdParam, body: { content: { 'application/json': { schema: OnboardingReview } } } },
    responses: jsonOk(GenericObject),
  }),
  async (c) => {
    const p = principalOf(c)
    const { cleaner_id } = c.req.valid('param')
    const r = await directory.reviewCleanerOnboarding({ cleanerId: cleaner_id, reviewerId: p.userId, payload: c.req.valid('json') as Record<string, unknown> })
    return c.json(ok(c, 'Onboarding reviewed', r), 200)
  },
)

// ============================ customers directory ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/customers', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip, search } = c.req.valid('query')
    const r = await directory.listCustomers({ limit, skip, search })
    return c.json(ok(c, 'Customers listed', r), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/customers/{customer_id}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: CustomerIdParamCore }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { customer_id } = c.req.valid('param')
    const r = await directory.getCustomer(customer_id)
    return c.json(ok(c, 'Customer fetched', r), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/customers/{customer_id}/places', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: CustomerIdParamCore }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { customer_id } = c.req.valid('param')
    const r = await directory.getCustomerPlaces(customer_id)
    return c.json(ok(c, 'Customer places', GenericList.parse(r)), 200)
  },
)

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/customers/{customer_id}/places',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { params: CustomerIdParamCore, body: { content: { 'application/json': { schema: AdminPlaceCreate } } } },
    responses: { 201: { description: 'Place added', content: { 'application/json': { schema: envelopeOf(GenericObject) } } }, ...errs },
  }),
  async (c) => {
    principalOf(c)
    const { customer_id } = c.req.valid('param')
    const r = await directory.addCustomerPlace({ customerId: customer_id, payload: c.req.valid('json') as Record<string, unknown> })
    return c.json(ok(c, 'Place added', r), 201)
  },
)

// ============================ cleaners directory ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/cleaners', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip, search } = c.req.valid('query')
    const r = await directory.listCleaners({ limit, skip, search })
    return c.json(ok(c, 'Cleaners listed', r), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/onboarding/queue', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip, search } = c.req.valid('query')
    const r = await directory.listOnboardingQueue({ limit, skip, search })
    return c.json(ok(c, 'Onboarding queue', r), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/cleaners/{cleaner_id}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: CleanerIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { cleaner_id } = c.req.valid('param')
    const r = await directory.getCleaner(cleaner_id)
    return c.json(ok(c, 'Cleaner fetched', r), 200)
  },
)

// ============================ users autocomplete ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/users/autocomplete', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AutocompleteQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { q, search, limit } = c.req.valid('query')
    const items = await directory.autocompleteUsers({ search: q ?? search ?? '', limit })
    return c.json(ok(c, 'User autocomplete', { items, total: items.length }), 200)
  },
)

// ============================ signup (admin creates admin) ============================

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/signup',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: AdminCreateSignup } } } },
    responses: {
      201: { description: 'Admin created', content: { 'application/json': { schema: envelopeOf(AdminOut) } } },
      409: { description: 'Email already exists', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    principalOf(c)
    const created = await mgmt.signup(c.req.valid('json'))
    return c.json(ok(c, 'Admin created', created), 201)
  },
)

// ============================ monitoring ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/overview', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Monitoring overview', await monitoring.overview()), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/auth/heatmap', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Auth heatmap', await monitoring.authHeatmap()), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/permissions/denied-top', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Top denied permissions', await monitoring.deniedPermissionsTop()), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/sessions/anomalies', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Session anomalies', await monitoring.sessionAnomalies()), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/alerts/sla', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip } = c.req.valid('query')
    return c.json(ok(c, 'SLA alerts', await monitoring.slaAlerts({ limit, skip })), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/alerts', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip } = c.req.valid('query')
    return c.json(ok(c, 'Alerts', await monitoring.alerts({ limit, skip })), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'patch', path: '/monitoring/alerts/{alert_id}/read', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: AlertIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    const p = principalOf(c)
    const { alert_id } = c.req.valid('param')
    return c.json(ok(c, 'Alert marked read', await monitoring.markAlertRead(alert_id, p.userId)), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'patch', path: '/monitoring/alerts/{alert_id}/ack', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: AlertIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    const p = principalOf(c)
    const { alert_id } = c.req.valid('param')
    return c.json(ok(c, 'Alert acknowledged', await monitoring.ackAlert(alert_id, p.userId)), 200)
  },
)

// --- audit export (on-demand) ---

adminCore.openapi(
  createRoute({
    method: 'post',
    path: '/monitoring/audit/export',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: AuditExportRequest } } } },
    responses: { 201: { description: 'Export created', content: { 'application/json': { schema: envelopeOf(GenericObject) } } }, ...errs },
  }),
  async (c) => {
    const p = principalOf(c)
    const r = await monitoring.createAuditExport({ requestedBy: p.userId, payload: c.req.valid('json') as Record<string, unknown> })
    return c.json(ok(c, 'Audit export created', r), 201)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/audit/export/{export_id}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: ExportIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { export_id } = c.req.valid('param')
    return c.json(ok(c, 'Audit export status', await monitoring.getAuditExport(export_id)), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/audit/export/{export_id}/download', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: ExportIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { export_id } = c.req.valid('param')
    return c.json(ok(c, 'Audit export download', await monitoring.downloadAuditExport(export_id)), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/audit/history', tags: [TAG], security: [{ bearerAuth: [] }], request: { query: AdminListQuery }, responses: jsonOk(GenericList) }),
  async (c) => {
    principalOf(c)
    const { limit, skip } = c.req.valid('query')
    return c.json(ok(c, 'Audit history', await monitoring.auditHistory({ limit, skip })), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/monitoring/audit/history/{event_id}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: EventIdParam }, responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    const { event_id } = c.req.valid('param')
    return c.json(ok(c, 'Audit event', await monitoring.auditHistoryById(event_id)), 200)
  },
)

// ============================ reports ============================

adminCore.openapi(
  createRoute({ method: 'get', path: '/reports/users/summary', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Users summary', await reporting.usersSummary()), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'get', path: '/reports/users/signups-trend', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(GenericObject) }),
  async (c) => {
    principalOf(c)
    return c.json(ok(c, 'Signups trend', await reporting.signupsTrend()), 200)
  },
)

// ============================ account deletion ============================

adminCore.openapi(
  createRoute({ method: 'delete', path: '/account', tags: [TAG], security: [{ bearerAuth: [] }], responses: jsonOk(z.object({ deleted: z.boolean() })) }),
  async (c) => {
    const p = principalOf(c)
    return c.json(ok(c, 'Account deleted', await mgmt.deleteAccount(p.userId)), 200)
  },
)

adminCore.openapi(
  createRoute({ method: 'delete', path: '/{admin_id}', tags: [TAG], security: [{ bearerAuth: [] }], request: { params: AdminIdParam }, responses: jsonOk(z.object({ deleted: z.boolean() })) }),
  async (c) => {
    principalOf(c)
    const { admin_id } = c.req.valid('param')
    return c.json(ok(c, 'Admin deleted', await mgmt.deleteAdmin(admin_id)), 200)
  },
)
