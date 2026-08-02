/**
 * Pure legacy -> canonical field mapping for admin-feature documents.
 *
 * These documents were written before the admin-feature schemas (see
 * `server/schemas/admin-features.ts`) settled on their canonical field names.
 * Some existing Mongo documents still carry the legacy snake_case / minor-unit
 * fields, which causes add-ons to price at 0, promos to discount 0%, and
 * service titles to render as literal placeholder text.
 *
 * Each `migrate*` function is a pure mapping: given a raw document, it returns
 * the patch that would repair it, without touching Mongo. The runner
 * (`server/scripts/migrate-admin-feature-fields.ts`) applies the patch via the
 * existing repositories. Keeping this module pure (no `mongodb` import) is
 * what makes it unit-testable and keeps the layering rule in `CLAUDE.md`.
 *
 * Two properties the tests pin down:
 *  - Idempotent: re-running against an already-migrated document produces an
 *    empty patch (`changed: false`), so re-running the runner is always safe.
 *  - Never clobber: if the canonical field is already present (even if falsy,
 *    e.g. `false` or `0`), the legacy value is never copied over it.
 */

export interface MigrationResult {
  changed: boolean
  patch: Record<string, unknown>
}

type RawDoc = Record<string, unknown>

/**
 * Copy `doc[legacyKey]` to `patch[canonicalKey]` only when:
 *  - the legacy key is present on the document, and
 *  - the canonical key is NOT already present (regardless of its value).
 *
 * Presence (not truthiness) is what "never clobber" and "preserve false"
 * both reduce to, so a single `in` check covers both requirements.
 */
function mapLegacyField(
  doc: RawDoc,
  legacyKey: string,
  canonicalKey: string,
  patch: RawDoc,
  transform: (value: unknown) => unknown = (v) => v,
): void {
  if (!(legacyKey in doc)) return
  if (canonicalKey in doc) return
  patch[canonicalKey] = transform(doc[legacyKey])
}

function toResult(patch: RawDoc): MigrationResult {
  return { changed: Object.keys(patch).length > 0, patch }
}

export function migrateServiceDefinition(doc: RawDoc): MigrationResult {
  const patch: RawDoc = {}
  mapLegacyField(doc, 'display_name', 'title', patch)
  mapLegacyField(doc, 'is_active', 'isAvailable', patch)
  mapLegacyField(doc, 'base_duration_minutes', 'minimumHours', patch, (v) => Number(v) / 60)
  mapLegacyField(doc, 'notes', 'description', patch)
  return toResult(patch)
}

export function migrateAddOn(doc: RawDoc): MigrationResult {
  const patch: RawDoc = {}
  mapLegacyField(doc, 'price_minor', 'price', patch, (v) => Number(v) / 100)
  return toResult(patch)
}

export function migratePromoCode(doc: RawDoc): MigrationResult {
  const patch: RawDoc = {}
  mapLegacyField(doc, 'discount_value', 'discountValue', patch)
  mapLegacyField(doc, 'discount_type', 'discountType', patch, (v) => String(v).toUpperCase())
  mapLegacyField(doc, 'is_active', 'active', patch)
  mapLegacyField(doc, 'valid_from_epoch', 'startsAt', patch)
  mapLegacyField(doc, 'valid_to_epoch', 'expiresAt', patch)
  return toResult(patch)
}
