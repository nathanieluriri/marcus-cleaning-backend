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
