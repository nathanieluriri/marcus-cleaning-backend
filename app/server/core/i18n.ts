import { createMiddleware } from 'hono/factory'
import type { Env, Locale } from './http-env'
import { validationError } from './errors'

/**
 * Localization (en/fr), ported from `core/i18n.py`.
 *
 * - Supported languages: en, fr.
 * - Accept-Language validated to supported values; invalid → 422.
 * - Default: en. For authenticated routes, account preferredLanguage may
 *   override via `c.set('locale', ...)` after auth resolves.
 *
 * See: ../../../docs/migration/12-rate-limiting-i18n.md
 */

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
export const DEFAULT_LANGUAGE: Locale = 'en'

const MESSAGES: Record<string, Partial<Record<Locale, string>>> = {
  'Validation error': { en: 'Validation error', fr: 'Erreur de validation' },
  'Internal Server Error': { en: 'Internal Server Error', fr: 'Erreur interne du serveur' },
  'Too Many Requests': { en: 'Too Many Requests', fr: 'Trop de requêtes' },
  'Invalid or expired token': { en: 'Invalid or expired token', fr: 'Jeton invalide ou expiré' },
  'Role not permitted': { en: 'Role not permitted', fr: 'Rôle non autorisé' },
  'Not found': { en: 'Not found', fr: 'Introuvable' },
}

export function translate(message: string, lang: Locale): string {
  return MESSAGES[message]?.[lang] ?? message
}

export function parseAcceptLanguage(header?: string | null): Locale {
  if (!header) return DEFAULT_LANGUAGE
  const primary = header.split(',')[0]?.trim().slice(0, 2).toLowerCase()
  if (primary && (SUPPORTED_LANGUAGES as readonly string[]).includes(primary)) {
    return primary as Locale
  }
  throw validationError({ field: 'Accept-Language' })
}

export const locale = () =>
  createMiddleware<Env>(async (c, next) => {
    const lang = parseAcceptLanguage(c.req.header('Accept-Language'))
    c.set('locale', lang)
    await next()
    c.header('Content-Language', c.get('locale'))
  })
