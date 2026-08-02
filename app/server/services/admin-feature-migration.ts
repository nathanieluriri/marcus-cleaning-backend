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
 * Properties the tests pin down:
 *  - Idempotent: re-running against an already-migrated document produces an
 *    empty patch (`changed: false`), so re-running the runner is always safe.
 *  - Never clobber: if the canonical field is already present (even if falsy,
 *    e.g. `false` or `0`), the legacy value is never copied over it. If the
 *    legacy and canonical values actually disagree, that is surfaced as a
 *    `conflict`, not silently swallowed.
 *  - Never write NaN / non-finite numbers: a malformed legacy value is
 *    reported via `invalid`, never copied into `patch`.
 *  - Never partially write a conflicted document: when ANY field on a
 *    document conflicts, the whole document is withheld from `--apply` (see
 *    the runner). Because `patch` still accumulates every OTHER field that
 *    migrated cleanly, those clean entries would otherwise be silently
 *    dropped along with the conflicting one. `withheldKeys` makes that loss
 *    visible instead: it lists exactly which canonical keys were computed
 *    but not written because a sibling field on the same document conflicts.
 */

export interface FieldConflict {
  legacyKey: string
  canonicalKey: string
  legacyValue: unknown
  canonicalValue: unknown
}

export interface MigrationResult {
  changed: boolean
  patch: Record<string, unknown>
  /** Legacy key present, canonical key present, but with a different value. Canonical wins; not written. */
  conflicts: FieldConflict[]
  /** Legacy keys present but deliberately NOT migrated — needs a human decision. Not written. */
  flagged: string[]
  /** Legacy keys present whose converted value was non-finite (e.g. NaN). Never written. */
  invalid: string[]
  /** True if the document has at least one key this function knows how to interpret (legacy or canonical). */
  recognised: boolean
  /**
   * Canonical keys that migrated cleanly (are present in `patch`) but will be
   * withheld from the write because `conflicts` is non-empty for this same
   * document — i.e. `conflicts.length > 0 ? Object.keys(patch) : []`.
   * Re-running the migration after the conflict is resolved by hand applies
   * these automatically, because the migration is idempotent.
   */
  withheldKeys: string[]
}

type RawDoc = Record<string, unknown>

interface MappingContext {
  patch: RawDoc
  conflicts: FieldConflict[]
  flagged: string[]
  invalid: string[]
  knownKeys: Set<string>
}

function newContext(): MappingContext {
  return { patch: {}, conflicts: [], flagged: [], invalid: [], knownKeys: new Set() }
}

interface MapFieldOptions {
  transform?: (value: unknown) => unknown
  /** Returns false when `transform`'s output must not be written (e.g. NaN). */
  isValid?: (transformed: unknown) => boolean
  equals?: (transformed: unknown, canonicalValue: unknown) => boolean
}

/**
 * Copy `doc[legacyKey]` to `ctx.patch[canonicalKey]` only when:
 *  - the legacy key is present on the document,
 *  - the transformed value is valid (not NaN / non-finite), and
 *  - the canonical key is NOT already present (regardless of its value).
 *
 * Presence (not truthiness) is what "never clobber" and "preserve false"
 * both reduce to, so a single `in` check covers both requirements. When the
 * canonical key IS present but disagrees with the (transformed) legacy
 * value, that is recorded as a conflict instead of silently dropped.
 */
function mapField(
  doc: RawDoc,
  legacyKey: string,
  canonicalKey: string,
  ctx: MappingContext,
  opts: MapFieldOptions = {},
): void {
  const { transform = (v: unknown) => v, isValid = () => true, equals = (a, b) => a === b } = opts
  ctx.knownKeys.add(legacyKey)
  ctx.knownKeys.add(canonicalKey)

  if (!(legacyKey in doc)) return

  const transformed = transform(doc[legacyKey])

  if (!isValid(transformed)) {
    ctx.invalid.push(legacyKey)
    return
  }

  if (canonicalKey in doc) {
    const canonicalValue = doc[canonicalKey]
    if (!equals(transformed, canonicalValue)) {
      ctx.conflicts.push({ legacyKey, canonicalKey, legacyValue: doc[legacyKey], canonicalValue })
    }
    return
  }

  ctx.patch[canonicalKey] = transformed
}

/** Legacy key deliberately not auto-migrated (Finding 3): record it for human review only. */
function flagForHumanReview(doc: RawDoc, legacyKey: string, ctx: MappingContext): void {
  ctx.knownKeys.add(legacyKey)
  if (legacyKey in doc) ctx.flagged.push(legacyKey)
}

const isFiniteNumber = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
/**
 * Convert only genuine numeric values. `Number(null)`, `Number('')`,
 * `Number('  ')`, `Number([])`, and `Number(false)` all evaluate to `0` in
 * JavaScript, which would make a malformed legacy value (a null/blank
 * price_minor, an empty discount_value) migrate as a real canonical `0`
 * instead of being caught by `isFiniteNumber` and reported via `invalid`.
 * Anything that is not a number or a non-empty numeric string yields `NaN`
 * so `isValid` rejects it. A legitimate `price_minor: 0` (an actually-free
 * add-on) still converts to `0` and is written normally.
 */
const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return Number.NaN
}

/**
 * Maps known legacy `discount_type` spellings onto the schema's strict
 * `'PERCENT' | 'FIXED'` enum. Returns `null` for anything unrecognised so
 * the caller can flag it for human review instead of writing a value the
 * schema will reject.
 */
function normalizeLegacyDiscountType(v: unknown): 'PERCENT' | 'FIXED' | null {
  const normalized = String(v).trim().toLowerCase()
  if (normalized === 'percentage' || normalized === 'percent' || normalized === '%') return 'PERCENT'
  if (normalized === 'fixed' || normalized === 'amount' || normalized === 'flat') return 'FIXED'
  return null
}

/**
 * Canonical keys that `mapField` writes by normalising a value already
 * stored under THAT SAME key, rather than by copying from a distinct legacy
 * key. `code` (promo codes: trim + uppercase in place) is the only current
 * example. These must NOT get an "absent" guard in `buildUpdateFilter`,
 * because the key is never absent — guarding it would make the filter
 * unsatisfiable and the normalisation would never write.
 */
const IN_PLACE_NORMALISED_KEYS = new Set<string>(['code'])

/**
 * Builds the Mongo filter for writing `patch` (Finding 2 / re-check own
 * precondition): the cursor read the document once, at the start of a long
 * scan-and-write pass over a live collection. By the time this document's
 * write happens, an admin could have set one of the canonical fields through
 * the console — that value must win over the stale legacy one.
 *
 * For every canonical key in `patch` that is a genuinely new field (i.e. not
 * in `IN_PLACE_NORMALISED_KEYS`), add `{ [key]: { $exists: false } }` to the
 * filter, so the write becomes a no-op if that field appeared after the
 * cursor read it. The migration is idempotent, so the next run just picks
 * the document up again — nothing is lost, only deferred.
 */
export function buildUpdateFilter(docId: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const filter: Record<string, unknown> = { _id: docId }
  for (const key of Object.keys(patch)) {
    if (IN_PLACE_NORMALISED_KEYS.has(key)) continue
    filter[key] = { $exists: false }
  }
  return filter
}

function toResult(doc: RawDoc, ctx: MappingContext): MigrationResult {
  const recognised = Object.keys(doc).some((key) => ctx.knownKeys.has(key))
  const withheldKeys = ctx.conflicts.length > 0 ? Object.keys(ctx.patch) : []
  return {
    changed: Object.keys(ctx.patch).length > 0,
    patch: ctx.patch,
    conflicts: ctx.conflicts,
    flagged: ctx.flagged,
    invalid: ctx.invalid,
    recognised,
    withheldKeys,
  }
}

export function migrateServiceDefinition(doc: RawDoc): MigrationResult {
  const ctx = newContext()
  mapField(doc, 'display_name', 'title', ctx)
  // `name` / `active` are a second legacy spelling `catalog-service.ts`
  // already falls back to at read time (`d.title ?? d.name`, `d.isAvailable
  // ?? d.active`), so mapping them here is consistent with what consumers
  // already treat as equivalent — not a behaviour change, just making the
  // canonical field explicit so the census/runner stop bucketing these
  // documents as "unrecognised".
  mapField(doc, 'name', 'title', ctx)
  mapField(doc, 'is_active', 'isAvailable', ctx)
  mapField(doc, 'active', 'isAvailable', ctx)
  mapField(doc, 'notes', 'description', ctx)
  // `base_duration_minutes` is deliberately NOT mapped to `minimumHours` — see
  // Finding 3: on hourly services minimumHours is a pricing floor, not the
  // same concept as a base duration, and auto-mapping it would silently
  // change customer quotes. The runner counts these under a "needs human
  // decision" heading instead of migrating them.
  flagForHumanReview(doc, 'base_duration_minutes', ctx)
  return toResult(doc, ctx)
}

export function migrateAddOn(doc: RawDoc): MigrationResult {
  const ctx = newContext()
  // Add-ons carry the same legacy vocabulary as service definitions
  // (Finding 1): a disabled/unnamed legacy add-on must not silently go live.
  mapField(doc, 'display_name', 'title', ctx)
  mapField(doc, 'name', 'title', ctx)
  mapField(doc, 'is_active', 'isAvailable', ctx)
  mapField(doc, 'active', 'isAvailable', ctx)
  mapField(doc, 'notes', 'description', ctx)
  mapField(doc, 'price_minor', 'price', ctx, {
    transform: (v) => toNumber(v) / 100,
    isValid: isFiniteNumber,
  })
  return toResult(doc, ctx)
}

export function migratePromoCode(doc: RawDoc): MigrationResult {
  const ctx = newContext()
  mapField(doc, 'discount_value', 'discountValue', ctx, {
    transform: toNumber,
    isValid: isFiniteNumber,
  })
  // `discountType` is a strict `z.enum(['PERCENT', 'FIXED'])` (see
  // `PromoCodeFields` in `server/schemas/admin-features.ts`). Naively
  // uppercasing the legacy value (e.g. the console's old `percentage`
  // placeholder) produces `"PERCENTAGE"`, which the schema rejects: the
  // migrated promo becomes uneditable (blank radio, 422 on PATCH). Map the
  // known legacy spellings explicitly; anything else is deliberately left
  // unmapped and flagged for a human, rather than writing a value the schema
  // will never accept.
  ctx.knownKeys.add('discount_type')
  ctx.knownKeys.add('discountType')
  if ('discount_type' in doc) {
    const normalized = normalizeLegacyDiscountType(doc.discount_type)
    if (normalized === null) {
      flagForHumanReview(doc, 'discount_type', ctx)
    } else if ('discountType' in doc) {
      const canonicalValue = doc.discountType
      if (canonicalValue !== normalized) {
        ctx.conflicts.push({
          legacyKey: 'discount_type',
          canonicalKey: 'discountType',
          legacyValue: doc.discount_type,
          canonicalValue,
        })
      }
    } else {
      ctx.patch.discountType = normalized
    }
  }
  mapField(doc, 'is_active', 'active', ctx)
  mapField(doc, 'valid_from_epoch', 'startsAt', ctx, {
    transform: toNumber,
    isValid: isFiniteNumber,
  })
  mapField(doc, 'valid_to_epoch', 'expiresAt', ctx, {
    transform: toNumber,
    isValid: isFiniteNumber,
  })

  // Finding 4: normalize the promo `code` itself (trim + uppercase), matching
  // `PromoCodeCreate`'s validation, but only write it when the normalized
  // value actually differs — otherwise every already-clean doc would report
  // `changed: true` on every run, breaking idempotency.
  ctx.knownKeys.add('code')
  if (typeof doc.code === 'string') {
    const normalized = doc.code.trim().toUpperCase()
    if (normalized !== doc.code) {
      ctx.patch.code = normalized
    }
  }

  return toResult(doc, ctx)
}
