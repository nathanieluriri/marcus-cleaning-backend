import { z } from '@hono/zod-openapi'

/**
 * Saved-address domain schemas (Zod + OpenAPI).
 *
 * Customers save an address by `place_id`; the server resolves the place
 * details (lat/lng, formatted address, components) and stores a snapshot.
 * Collection: `saved_addresses`.
 *
 * See: docs/migration/07-domain-endpoints.md (`/v1/customers` addresses),
 *      docs/migration/02-data-model.md (Places & addresses).
 */

/** Public saved-address view (id as string, `customerId` derived from token). */
export const SavedAddressOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    customerId: z.string().openapi({ example: '665f1b2c9a1e4b0012abcd00' }),
    placeId: z.string().openapi({ example: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }),
    label: z.string().nullable().default(null).openapi({ example: 'Home' }),
    formattedAddress: z.string().nullable().default(null),
    line1: z.string().nullable().default(null),
    line2: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    state: z.string().nullable().default(null),
    postalCode: z.string().nullable().default(null),
    country: z.string().nullable().default(null),
    latitude: z.number().nullable().default(null),
    longitude: z.number().nullable().default(null),
    notes: z.string().nullable().default(null),
    isDefault: z.boolean().default(false),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('SavedAddressOut')
export type SavedAddressOut = z.infer<typeof SavedAddressOut>

/** Create payload — client supplies `place_id`; server resolves the rest. */
export const SavedAddressCreate = z
  .object({
    place_id: z.string().min(1).openapi({ example: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }),
    label: z.string().optional(),
    line2: z.string().optional(),
    notes: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi('SavedAddressCreate')
export type SavedAddressCreate = z.infer<typeof SavedAddressCreate>

/** Update payload — mutable client-controlled fields only. */
export const SavedAddressUpdate = z
  .object({
    label: z.string().optional(),
    line2: z.string().optional(),
    notes: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi('SavedAddressUpdate')
export type SavedAddressUpdate = z.infer<typeof SavedAddressUpdate>

/** Internal DB document shape for the `saved_addresses` collection. */
export interface SavedAddressDoc {
  customerId: string
  placeId: string
  label?: string | null
  formattedAddress?: string | null
  line1?: string | null
  line2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  notes?: string | null
  isDefault: boolean
  dateCreated: number
  lastUpdated: number
}
