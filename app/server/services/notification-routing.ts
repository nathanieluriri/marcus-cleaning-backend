import { getSettings } from '@/server/core/settings'

/**
 * The single place that decides, for a notification type: which Android
 * channel it uses, which sound it plays, and where tapping it navigates.
 *
 * The apps navigate from `type` + `entityType`/`entityId` ("Option C"), NOT from
 * the `route` string. Routes are still emitted as a fallback — useful if we ever
 * want a server-driven destination without an app release — but a stale route
 * degrades to "opens the app", never to a wrong screen. That is why the app-side
 * switch is authoritative and this table is advisory.
 *
 * A note on Android sound, because it is a common source of "the sound doesn't
 * work" bugs: on Android 8+ the sound belongs to the CHANNEL, and the channel is
 * created by the app. The server can only name a `channelId`. If the app has not
 * created that channel with the sound attached, nothing we send changes what the
 * user hears. On iOS the `sound` filename below is authoritative and must match
 * a file bundled in the app.
 */

/**
 * Android channel ids. The app must create each of these at startup.
 *
 * Versioned (`_v1`) at the frontend's request, and they were right to ask: a
 * channel's sound is immutable once created, so an unversioned id would lock
 * every existing install into whatever sound shipped first. Changing a sound
 * means publishing `_v2` and updating the value here.
 */
export const NotificationChannel = {
  JOBS: 'jobs_v1',
  CHAT: 'chat_v1',
  PAYOUTS: 'payouts_v1',
  PROMOS: 'promos_v1',
  SAFETY: 'safety_v1',
  GENERAL: 'general_v1',
} as const
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

/**
 * iOS sound filenames — WITH extension, resolved against the app bundle root.
 * Android takes its sound from the channel instead, so this is iOS-only.
 */
export const NotificationSound = {
  SWEEPING: 'sweeping.caf',
  MOPPING: 'mopping.caf',
  DEFAULT: 'default',
} as const
export type NotificationSound = (typeof NotificationSound)[keyof typeof NotificationSound]

export interface RoutingEntry {
  channelId: NotificationChannel
  sound: NotificationSound
  /**
   * In-app route template, e.g. `/bookings/:bookingId`. Placeholders are
   * substituted from the notification's data payload.
   */
  route: string | null
  /** Override for the staff app, where the same event lands on a different screen. */
  cleanerRoute?: string | null
  /** Primary entity the notification is about, for structural routing. */
  entityType: string | null
  /** Which data key holds that entity's id. */
  entityIdKey: string | null
  /**
   * Data key whose value collapses repeat notifications into one tray entry
   * (FCM `collapseKey` / APNs `apns-collapse-id` / Android `tag`).
   */
  collapseKey?: string
  /** True if this type is marketing and must honour the opt-out. */
  marketing?: boolean
}

const GENERAL: RoutingEntry = {
  channelId: NotificationChannel.GENERAL,
  sound: NotificationSound.DEFAULT,
  route: null,
  entityType: null,
  entityIdKey: null,
}

/**
 * type -> routing. Routes are the frontend's "Route today" values; several are
 * deliberately a tab rather than a detail screen because the detail screen does
 * not exist yet.
 */
const ROUTING: Record<string, RoutingEntry> = {
  // --- bookings + jobs ---
  'booking.created': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    cleanerRoute: '/jobs/request/:bookingId',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },
  'booking.cancelled': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    // Deliberately NOT /jobs/request/:id — that screen offers accept/decline on
    // a job that no longer exists.
    cleanerRoute: '/jobs',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },
  'booking.rescheduled': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    cleanerRoute: '/calendar',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },
  'job.en_route': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },
  'job.started': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },
  'job.completed': {
    channelId: NotificationChannel.JOBS,
    sound: NotificationSound.SWEEPING,
    route: '/bookings/:bookingId',
    entityType: 'booking',
    entityIdKey: 'bookingId',
  },

  // --- chat ---
  'chat.message': {
    channelId: NotificationChannel.CHAT,
    sound: NotificationSound.SWEEPING,
    route: '/chat/:conversationId',
    // The staff app has no chat screen yet; it opens the app until one exists.
    cleanerRoute: null,
    entityType: 'conversation',
    entityIdKey: 'conversationId',
    // Twenty messages must not produce twenty tray entries.
    collapseKey: 'conversationId',
  },

  // --- money ---
  'payout.requested': {
    channelId: NotificationChannel.PAYOUTS,
    sound: NotificationSound.SWEEPING,
    route: '/earnings',
    entityType: 'payout',
    entityIdKey: 'payoutId',
  },
  'payout.paid': {
    channelId: NotificationChannel.PAYOUTS,
    sound: NotificationSound.SWEEPING,
    route: '/earnings',
    entityType: 'payout',
    entityIdKey: 'payoutId',
  },
  'payout.failed': {
    channelId: NotificationChannel.PAYOUTS,
    sound: NotificationSound.SWEEPING,
    route: '/earnings',
    entityType: 'payout',
    entityIdKey: 'payoutId',
  },

  // --- onboarding ---
  'application.submitted': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/signup/verification',
    entityType: 'application',
    entityIdKey: 'applicationId',
  },
  'application.under_review': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/signup/verification',
    entityType: 'application',
    entityIdKey: 'applicationId',
  },
  'application.more_info_required': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/signup/verification',
    entityType: 'application',
    entityIdKey: 'applicationId',
  },
  'application.approved': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/signup/verification',
    entityType: 'application',
    entityIdKey: 'applicationId',
  },
  'application.rejected': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/signup/verification',
    entityType: 'application',
    entityIdKey: 'applicationId',
  },

  // --- safety ---
  'sos.raised': {
    channelId: NotificationChannel.SAFETY,
    sound: NotificationSound.DEFAULT,
    // Back to the job in hand, not a new screen to dismiss.
    route: '/jobs/active/:bookingId',
    entityType: 'sosAlert',
    entityIdKey: 'alertId',
  },

  // --- support + marketing ---
  'support.ticket_created': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: '/help/contact',
    cleanerRoute: '/profile/help',
    entityType: 'ticket',
    entityIdKey: 'ticketId',
  },
  'promo.broadcast': {
    channelId: NotificationChannel.PROMOS,
    sound: NotificationSound.MOPPING,
    route: '/home',
    entityType: 'promotion',
    entityIdKey: 'promoId',
    // The ONLY type that honours the marketing opt-out.
    marketing: true,
  },
  'admin.broadcast': {
    channelId: NotificationChannel.GENERAL,
    sound: NotificationSound.DEFAULT,
    route: null,
    entityType: null,
    entityIdKey: null,
  },
}

export function routingFor(type: string | null | undefined): RoutingEntry {
  return (type && ROUTING[type]) || GENERAL
}

/** True if this notification type must respect the marketing opt-out. */
export function isMarketingType(type: string | null | undefined): boolean {
  return routingFor(type).marketing === true
}

/** Every type we know about — used by the admin composer and the contract doc. */
export function knownNotificationTypes(): string[] {
  return Object.keys(ROUTING).sort()
}

/**
 * Fill `:placeholder` segments in a route template from the data payload.
 * Returns null if any placeholder has no value, since a half-built route is
 * worse than none — it would navigate somewhere wrong.
 */
export function buildRoute(
  template: string | null | undefined,
  data: Record<string, unknown>,
): string | null {
  if (!template) return null
  let missing = false
  const route = template.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = data[key]
    if (value == null || value === '') {
      missing = true
      return ''
    }
    return encodeURIComponent(String(value))
  })
  return missing ? null : route
}

/**
 * Turn an in-app route into a tappable deep link using the configured scheme.
 *
 * Deliberately swallows a settings failure: the deep link is a convenience on
 * top of `type` + `entityId`, and a config problem must not be able to take
 * push delivery down with it.
 */
export function buildDeepLink(route: string | null): string | null {
  if (!route) return null
  try {
    const scheme = getSettings().APP_DEEP_LINK_SCHEME
    if (!scheme) return null
    return `${scheme}://${route.replace(/^\/+/, '')}`
  } catch {
    return null
  }
}

export interface NavigationPayload {
  channelId: string
  sound: string
  route?: string
  deepLink?: string
  entityType?: string
  entityId?: string
  collapseKey?: string
}

/**
 * Build the navigation half of a push payload.
 *
 * Emits BOTH the structured reference the apps actually route on and, where a
 * template resolves, a `route` + `deepLink` fallback. `role` selects the staff
 * app's route where it differs from the customer's.
 */
export function navigationFor(
  type: string | null | undefined,
  data: Record<string, unknown>,
  role: 'customer' | 'cleaner' = 'customer',
): NavigationPayload {
  const entry = routingFor(type)

  // `cleanerRoute` may be explicitly null to mean "no screen exists yet", which
  // is different from "not specified" — hence the `in` check rather than `??`.
  const template =
    role === 'cleaner' && 'cleanerRoute' in entry ? entry.cleanerRoute : entry.route

  const route = buildRoute(template, data)
  const deepLink = buildDeepLink(route)

  const payload: NavigationPayload = { channelId: entry.channelId, sound: entry.sound }
  if (route) payload.route = route
  if (deepLink) payload.deepLink = deepLink
  if (entry.entityType) payload.entityType = entry.entityType

  if (entry.entityIdKey) {
    const id = data[entry.entityIdKey]
    if (id != null && id !== '') payload.entityId = String(id)
  }

  if (entry.collapseKey) {
    const key = data[entry.collapseKey]
    if (key != null && key !== '') payload.collapseKey = String(key)
  }

  return payload
}
