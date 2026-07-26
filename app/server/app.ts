import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getSettings, isProduction } from './core/settings'
import { fail } from './core/envelope'
import { AppError } from './core/errors'
import { translate, locale } from './core/i18n'
import { timing } from './core/request-context'
import { rateLimit } from './core/rate-limit'
import { mountDocs } from './core/openapi'
import { createRouter } from './core/router'

import { health } from './routes/health'
import { customers } from './routes/customers'
import { customerExtras } from './routes/customer-extras'
import { cleaners } from './routes/cleaners'
import { admins } from './routes/admins'
import { adminFeatures } from './routes/admin-features'
import { adminCore } from './routes/admin-core'
import { bookingDiscovery } from './routes/booking-discovery'
import { bookings } from './routes/bookings'
import { payments } from './routes/payments'
import { places } from './routes/places'
import { documents } from './routes/documents'
import { reviews } from './routes/reviews'
import { catalog } from './routes/catalog'
import { home } from './routes/home'
import { notifications } from './routes/notifications'
import { banners } from './routes/banners'
import { customerOauth, cleanerOauth } from './routes/oauth'
import { cleanerJobs } from './routes/cleaner-jobs'
import { cleanerProfile } from './routes/cleaner-profile'
import { cleanerApplications } from './routes/cleaner-applications'
import { cleanerWorkspace } from './routes/cleaner-workspace'
import { adminSafety } from './routes/admin-safety'
import { chat } from './routes/chat'
import { devices } from './routes/devices'
import { promotions } from './routes/promotions'
import { support, faq } from './routes/support'
import { cron } from './routes/cron'

/**
 * Hono application. Mounted as a single Next.js catch-all route via hono/vercel.
 * See: docs/migration/04-api-layer.md
 */

function allowedOrigins(): string[] {
  const raw = getSettings().CORS_ORIGINS
  if (!raw) return ['http://localhost:3000']
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export const app = createRouter()

// --- global middleware (order matters) ---
app.use('*', requestId())
app.use('*', timing())
app.use('/api/*', async (c, next) => {
  const origins = allowedOrigins()
  const handler = cors({
    origin: (origin) => (origins.includes(origin) ? origin : origins[0]),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Request-ID'],
    exposeHeaders: [
      'X-Request-Id',
      'X-Process-Time',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'Content-Language',
    ],
    credentials: true,
  })
  return handler(c, next)
})
app.use('/api/*', locale())
app.use('/api/*', rateLimit())

// --- routers ---
app.route('/api/v1/customers', customers)
app.route('/api/v1/customers', customerExtras)
app.route('/api/v1/customers', customerOauth)
app.route('/api/v1/cleaners', cleaners)
app.route('/api/v1/cleaners', cleanerOauth)
app.route('/api/v1/cleaner', cleanerJobs)
app.route('/api/v1/cleaner', cleanerProfile)
app.route('/api/v1/cleaner', cleanerApplications)
app.route('/api/v1/cleaner', cleanerWorkspace)
app.route('/api/v1/admins', admins)
app.route('/api/v1/admins', adminCore)
app.route('/api/v1/admins', adminFeatures)
app.route('/api/v1/admins', adminSafety)
app.route('/api/v1/bookings', bookingDiscovery)
app.route('/api/v1/bookings', bookings)
app.route('/api/v1/payments', payments)
app.route('/api/v1/places', places)
app.route('/api/v1/documents', documents)
app.route('/api/v1/reviews', reviews)
app.route('/api/v1/services', catalog)
app.route('/api/v1/home', home)
app.route('/api/v1/notifications', notifications)
app.route('/api/v1/banners', banners)
app.route('/api/v1/conversations', chat)
app.route('/api/v1/devices', devices)
app.route('/api/v1/promotions', promotions)
app.route('/api/v1/support', support)
app.route('/api/v1/faq', faq)
app.route('/api/cron', cron)
app.route('/api', health)

// --- docs ---
mountDocs(app)

// --- error handling ---
app.notFound((c) => c.json(fail(c, translate('Not found', c.get('locale') ?? 'en'), 'NOT_FOUND'), 404))

app.onError((err, c) => {
  const lang = c.get('locale') ?? 'en'
  if (err instanceof AppError) {
    return c.json(
      fail(c, translate(err.message, lang), err.code, err.details),
      err.httpStatus as ContentfulStatusCode,
    )
  }
  const details = getSettings().DEBUG_INCLUDE_ERROR_DETAILS && !isProduction() ? String(err) : null
  return c.json(fail(c, translate('Internal Server Error', lang), 'INTERNAL_ERROR', details), 500)
})
