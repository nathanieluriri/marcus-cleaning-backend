import * as fcm from '@/server/core/push/fcm'
import * as notificationsRepo from '@/server/repositories/notifications-repo'
import * as deviceRepo from '@/server/repositories/device-repo'
import type { BookingOut } from '@/server/schemas/booking'
import type { NotificationOut } from '@/server/schemas/notification'
import { navigationFor } from '@/server/services/notification-routing'

/**
 * One place that turns a domain event into (a) a persisted notification row and
 * (b) a push to the recipient's registered devices.
 *
 * Persistence always happens; push is best-effort. A push failure must never
 * fail the business operation that triggered it, so every error is swallowed
 * here after being surfaced in the server log.
 *
 * No HTTP types — callable from services, routes, and cron alike.
 */

export type Recipient = 'customer' | 'cleaner'

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Data payloads must be string-valued for FCM. */
function stringifyData(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v == null) continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

/** Persist a notification and push it to the recipient's devices. */
export async function notify(args: {
  userId: string
  role: Recipient
  title: string
  body: string
  type?: string | null
  data?: Record<string, unknown> | null
}): Promise<NotificationOut> {
  const ts = nowEpoch()
  const stored = await notificationsRepo.insert({
    customer_id: args.userId,
    recipientRole: args.role,
    title: args.title,
    body: args.body,
    type: args.type ?? null,
    read: false,
    data: args.data ?? null,
    dateCreated: ts,
    lastUpdated: ts,
  })

  const data = { ...stringifyData(args.data), notificationId: stored.id, type: args.type ?? '' }
  await push(args.userId, args.role, { title: args.title, body: args.body, data })

  return stored
}

/**
 * Push to every active device for a user. Silent no-op when FCM is unconfigured.
 *
 * The navigation half of the payload (channel, sound, route, deep link, entity
 * refs) is resolved centrally in notification-routing, so callers only supply
 * the human-facing text and the ids.
 */
export async function push(
  userId: string,
  role: Recipient,
  msg: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  if (!fcm.isConfigured()) return
  try {
    const [devices, unread] = await Promise.all([
      deviceRepo.listActiveFor(userId, role),
      notificationsRepo.countUnread(userId, role),
    ])
    if (devices.length === 0) return

    const nav = navigationFor(msg.data?.type, msg.data ?? {}, role)
    const data: Record<string, string> = { ...(msg.data ?? {}) }
    if (nav.route) data.route = nav.route
    if (nav.deepLink) data.deepLink = nav.deepLink
    if (nav.entityType) data.entityType = nav.entityType
    if (nav.entityId) data.entityId = nav.entityId

    await Promise.all(
      devices.map(async (device) => {
        const outcome = await fcm.send({
          token: device.token,
          title: msg.title,
          body: msg.body,
          data,
          badge: unread,
          channelId: nav.channelId,
          sound: nav.sound,
          collapseKey: nav.collapseKey,
        })
        if (!outcome.ok && outcome.tokenInvalid) await deviceRepo.disableToken(device.token)
      }),
    )
  } catch (err) {
    console.error('[push] dispatch failed', err)
  }
}

/**
 * Notify both parties on a booking, skipping whoever performed the action.
 * The cleaner is skipped entirely when the booking is still unassigned.
 */
export async function notifyBookingParties(args: {
  booking: BookingOut
  actorRole: string
  title: string
  body: string
  type: string
  data?: Record<string, unknown>
}): Promise<void> {
  const data = { bookingId: args.booking.id, ...args.data }
  const targets: Array<{ userId: string; role: Recipient }> = []

  if (args.actorRole !== 'customer') targets.push({ userId: args.booking.customer_id, role: 'customer' })
  if (args.actorRole !== 'cleaner' && args.booking.cleaner_id) {
    targets.push({ userId: args.booking.cleaner_id, role: 'cleaner' })
  }

  await Promise.all(
    targets.map((t) =>
      notify({ ...t, title: args.title, body: args.body, type: args.type, data }).catch((err) => {
        console.error('[notify] failed for', t.role, err)
        return null
      }),
    ),
  )
}
