import { z } from '@hono/zod-openapi'
import { PreferredLanguage } from './customer'

/**
 * Admin-core schemas (the non-auth `/v1/admins` core endpoints).
 *
 * Many of these back heavy analytics/monitoring endpoints whose exact response
 * shapes await the ported Pydantic models; those output schemas are permissive
 * (`.passthrough()`) with a TODO. Request bodies are validated where the shape
 * is known. See: docs/migration/07-domain-endpoints.md
 */

// --- profile language ---
export const LanguageOut = z.object({ language: PreferredLanguage }).openapi('AdminLanguageOut')
export const LanguageUpdate = z.object({ language: PreferredLanguage }).openapi('AdminLanguageUpdate')
export type LanguageUpdate = z.infer<typeof LanguageUpdate>

// --- access / elevation ---
export const ElevationRequest = z
  .object({
    requestedPermissions: z.array(z.string()).optional(),
    reason: z.string().optional(),
  })
  .passthrough()
  .openapi('AdminElevationRequest')
export type ElevationRequest = z.infer<typeof ElevationRequest>

export const PermissionGroupCreate = z
  .object({
    name: z.string().min(1),
    permissions: z.array(z.string()).default([]),
  })
  .passthrough()
  .openapi('AdminPermissionGroupCreate')
export type PermissionGroupCreate = z.infer<typeof PermissionGroupCreate>

export const AccessDecision = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    notes: z.string().optional(),
  })
  .openapi('AdminAccessDecision')
export type AccessDecision = z.infer<typeof AccessDecision>

// --- permission templates ---
export const PermissionTemplateUpsert = z
  .object({
    permissions: z.array(z.string()).default([]),
  })
  .passthrough()
  .openapi('AdminPermissionTemplateUpsert')
export type PermissionTemplateUpsert = z.infer<typeof PermissionTemplateUpsert>

export const PermissionTemplatePreview = z.object({}).passthrough().openapi('AdminPermissionTemplatePreview')
export type PermissionTemplatePreview = z.infer<typeof PermissionTemplatePreview>

// --- onboarding review ---
export const OnboardingReview = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_INFO']),
    notes: z.string().optional(),
  })
  .passthrough()
  .openapi('AdminOnboardingReview')
export type OnboardingReview = z.infer<typeof OnboardingReview>

// --- customer places (admin-side) ---
export const AdminPlaceCreate = z
  .object({ place_id: z.string().optional() })
  .passthrough()
  .openapi('AdminPlaceCreate')
export type AdminPlaceCreate = z.infer<typeof AdminPlaceCreate>

// --- signup (admin creates admin) ---
export const AdminCreateSignup = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
    permissionList: z.array(z.string()).optional(),
  })
  .openapi('AdminCreateSignup')
export type AdminCreateSignup = z.infer<typeof AdminCreateSignup>

// --- access presets ---
export const AccessPresetUpdate = z
  .object({ preset: z.string().min(1) })
  .openapi('AdminAccessPresetUpdate')
export type AccessPresetUpdate = z.infer<typeof AccessPresetUpdate>

export const AccessPresetBulkUpdate = z
  .object({
    adminIds: z.array(z.string().min(1)).min(1),
    preset: z.string().min(1),
  })
  .openapi('AdminAccessPresetBulkUpdate')
export type AccessPresetBulkUpdate = z.infer<typeof AccessPresetBulkUpdate>

export const AccessPresetBulkResult = z
  .object({
    updated: z.number().int(),
    skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
  })
  .openapi('AdminAccessPresetBulkResult')
export type AccessPresetBulkResult = z.infer<typeof AccessPresetBulkResult>

export const AccessPresetCatalogItem = z
  .object({
    key: z.string(),
    label: z.string(),
    description: z.string(),
    permissionCount: z.number().int(),
  })
  .openapi('AdminAccessPresetCatalogItem')
export type AccessPresetCatalogItem = z.infer<typeof AccessPresetCatalogItem>

export const AccessPresetCatalogOut = z
  .object({ items: z.array(AccessPresetCatalogItem) })
  .openapi('AdminAccessPresetCatalogOut')
export type AccessPresetCatalogOut = z.infer<typeof AccessPresetCatalogOut>

// --- invites ---
export const AdminInviteRequest = z
  .object({
    email: z.email(),
    fullName: z.string().min(1),
    accessPreset: z.string().min(1),
  })
  .openapi('AdminInviteRequest')
export type AdminInviteRequest = z.infer<typeof AdminInviteRequest>

// --- audit export ---
export const AuditExportRequest = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .passthrough()
  .openapi('AdminAuditExportRequest')
export type AuditExportRequest = z.infer<typeof AuditExportRequest>

// --- shared list query ---
export const AdminListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
  search: z.string().optional(),
})
export type AdminListQuery = z.infer<typeof AdminListQuery>

/**
 * Per-route query schemas for the monitoring lists.
 *
 * `AdminListQuery` stays the shared pagination base. Routes that accept filters
 * extend it rather than reusing it bare, because a Zod object silently drops keys
 * it doesn't declare: `/monitoring/alerts`, `/monitoring/alerts/sla` and
 * `/monitoring/audit/history` all advertised a filter UI whose params were parsed
 * away before the handler ran. Declaring them per route also makes each route's
 * OpenAPI entry list the params it actually honours.
 *
 * Wire names stay snake_case for client parity; routes map them to the camelCase
 * repo options. Booleans are enums rather than `z.coerce.boolean()`, which would
 * read the string `'false'` as `true`. No `.transform()` here — transforms produce
 * ZodEffects, which the OpenAPI generator can't describe as a query parameter.
 */
export const AlertListQuery = AdminListQuery.extend({
  status: z.enum(['open', 'acknowledged']).optional(),
  unreadOnly: z.enum(['true', 'false']).optional(),
})
export type AlertListQuery = z.infer<typeof AlertListQuery>

export const SlaAlertsQuery = AdminListQuery.extend({
  hours: z.coerce.number().int().positive().max(24 * 365).optional(),
})
export type SlaAlertsQuery = z.infer<typeof SlaAlertsQuery>

export const AuditHistoryQuery = AdminListQuery.extend({
  cursor: z.string().optional(),
  sort: z.enum(['asc', 'desc']).optional(),
  actor_id: z.string().optional(),
  target_id: z.string().optional(),
  endpoint: z.string().optional(),
  event_type: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  /** Comma-joined on the wire (`tags=auth,admin`); split in the route. */
  tags: z.string().optional(),
  from_epoch: z.coerce.number().int().optional(),
  to_epoch: z.coerce.number().int().optional(),
})
export type AuditHistoryQuery = z.infer<typeof AuditHistoryQuery>

export const AutocompleteQuery = z.object({
  q: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
})
export type AutocompleteQuery = z.infer<typeof AutocompleteQuery>

// --- permissive generic outputs ---
export const GenericObject = z.object({}).passthrough().openapi('AdminGenericObject')
export const GenericList = z
  .object({ items: z.array(z.object({}).passthrough()), total: z.number().int().optional() })
  .openapi('AdminGenericList')

// --- path params ---
export const RoleParam = z.object({
  role: z.string().openapi({ param: { name: 'role', in: 'path' } }),
})
export const RequestIdParam = z.object({
  request_id: z.string().openapi({ param: { name: 'request_id', in: 'path' } }),
})
export const CleanerIdParam = z.object({
  cleaner_id: z.string().openapi({ param: { name: 'cleaner_id', in: 'path' } }),
})
export const CustomerIdParamCore = z.object({
  customer_id: z.string().openapi({ param: { name: 'customer_id', in: 'path' } }),
})
export const AlertIdParam = z.object({
  alert_id: z.string().openapi({ param: { name: 'alert_id', in: 'path' } }),
})
export const ExportIdParam = z.object({
  export_id: z.string().openapi({ param: { name: 'export_id', in: 'path' } }),
})
export const EventIdParam = z.object({
  event_id: z.string().openapi({ param: { name: 'event_id', in: 'path' } }),
})
export const AdminIdParam = z.object({
  admin_id: z.string().openapi({ param: { name: 'admin_id', in: 'path' } }),
})
