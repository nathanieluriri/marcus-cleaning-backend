import { getSettings } from './settings'

/**
 * Per-role rate-limit configuration.
 * Ported from `core/role_config.py` (build_role_rate_limits / normalize_role).
 *
 * Override via the `ROLE_RATE_LIMITS` env CSV, e.g.
 *   anonymous:20/minute,cleaner:80/minute,customer:80/minute,admin:140/minute
 *
 * See: ../../../docs/migration/12-rate-limiting-i18n.md
 */

export type RateRule = { amount: number; windowSeconds: number }

const DEFAULTS: Record<string, RateRule> = {
  anonymous: { amount: 20, windowSeconds: 60 },
  customer: { amount: 80, windowSeconds: 60 },
  cleaner: { amount: 80, windowSeconds: 60 },
  admin: { amount: 140, windowSeconds: 60 },
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
}

export function normalizeRole(role: string | null | undefined): string {
  const r = (role ?? 'anonymous').trim().toLowerCase()
  return r in DEFAULTS ? r : 'anonymous'
}

function parseCsv(csv: string): Record<string, RateRule> {
  const out: Record<string, RateRule> = {}
  for (const entry of csv.split(',')) {
    const [rolePart, rulePart] = entry.split(':').map((s) => s.trim())
    if (!rolePart || !rulePart) continue
    const [amountStr, unit] = rulePart.split('/').map((s) => s.trim().toLowerCase())
    const amount = Number(amountStr)
    const windowSeconds = UNIT_SECONDS[unit] ?? UNIT_SECONDS[unit.replace(/s$/, '')] ?? 60
    if (Number.isFinite(amount) && amount > 0) out[rolePart.toLowerCase()] = { amount, windowSeconds }
  }
  return out
}

let cached: Record<string, RateRule> | null = null

export function getRoleRateLimits(): Record<string, RateRule> {
  if (cached) return cached
  const csv = getSettings().ROLE_RATE_LIMITS
  cached = { ...DEFAULTS, ...(csv ? parseCsv(csv) : {}) }
  return cached
}

export function __resetRoleRateLimitsCache(): void {
  cached = null
}
