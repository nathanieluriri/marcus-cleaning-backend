import { createRouter } from '@/server/core/router'
import { crudRouter } from './_crud'
import { serviceCredits } from './service-credits'
import { broadcasts } from './broadcasts'
import { conciergeBookings } from './concierge-bookings'
import { claimReviews } from './claim-reviews'

/**
 * Admin-feature sub-routers, nested under /v1/admins.
 *
 * Nine features are plain CRUD (built inline from the `crudRouter` factory); four
 * carry extra endpoints and live in their own files. All are admin-guarded inside
 * the factory / their own modules. Mounted at /api/v1/admins in server/app.ts.
 *
 * See: docs/migration/07-domain-endpoints.md (admin-feature sub-router table).
 */

// --- plain CRUD features (collection names per docs/migration/02-data-model.md) ---
const serviceDefinitions = crudRouter({ collection: 'service_definitions', tag: 'ServiceDefinitions', noun: 'service definition' })
const addOns = crudRouter({ collection: 'addon_catalog', tag: 'AddOns', noun: 'add-on' })
const pricingRules = crudRouter({ collection: 'dynamic_pricing_rule', tag: 'PricingRules', noun: 'pricing rule' })
const serviceAreas = crudRouter({ collection: 'service_area_boundary', tag: 'ServiceAreas', noun: 'service area' })
const cleanerTags = crudRouter({ collection: 'cleaner_skill_equipment_tag', tag: 'CleanerTags', noun: 'cleaner tag' })
const availabilityOverrides = crudRouter({ collection: 'availability_override', tag: 'AvailabilityOverrides', noun: 'availability override' })
const promoCodes = crudRouter({ collection: 'promo_code', tag: 'PromoCodes', noun: 'promo code' })
const payoutAdjustments = crudRouter({ collection: 'payout_adjustment', tag: 'PayoutAdjustments', noun: 'payout adjustment' })
const chatInterventions = crudRouter({ collection: 'chat_intervention', tag: 'ChatInterventions', noun: 'chat intervention' })

export const adminFeatures = createRouter()

adminFeatures.route('/service-definitions', serviceDefinitions)
adminFeatures.route('/add-ons', addOns)
adminFeatures.route('/pricing-rules', pricingRules)
adminFeatures.route('/service-areas', serviceAreas)
adminFeatures.route('/cleaner-tags', cleanerTags)
adminFeatures.route('/availability-overrides', availabilityOverrides)
adminFeatures.route('/promo-codes', promoCodes)
adminFeatures.route('/payout-adjustments', payoutAdjustments)
adminFeatures.route('/chat-interventions', chatInterventions)

// --- features with extra endpoints ---
adminFeatures.route('/service-credits', serviceCredits)
adminFeatures.route('/broadcasts', broadcasts)
adminFeatures.route('/concierge-bookings', conciergeBookings)
adminFeatures.route('/claim-reviews', claimReviews)
