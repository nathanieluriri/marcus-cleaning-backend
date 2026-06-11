import { notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as notificationsRepo from '@/server/repositories/notifications-repo'
import type {
  NotificationCreateRequest,
  NotificationUpdateRequest,
  NotificationOut,
} from '@/server/schemas/notification'

/**
 * Notification CRUD business logic. Customer-scoped.
 * Ported from `notifications_service.py`. No HTTP types here.
 * See: docs/migration/06-services-and-repositories.md
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** List the calling customer's notifications. */
export async function listNotifications(args: { principal: AuthPrincipal }): Promise<NotificationOut[]> {
  return notificationsRepo.list({ customer_id: args.principal.userId })
}

/** Load a notification owned by the caller (404 if missing, 403 if not owner). */
export async function getNotification(args: {
  principal: AuthPrincipal
  id: string
}): Promise<NotificationOut> {
  const notification = await notificationsRepo.getById(args.id)
  if (!notification) throw notFound('Notification not found')
  if (notification.customer_id !== args.principal.userId) {
    throw forbidden('You are not allowed to access this notification')
  }
  return notification
}

/** Create a notification for the calling customer. */
export async function createNotification(args: {
  principal: AuthPrincipal
  payload: NotificationCreateRequest
}): Promise<NotificationOut> {
  const ts = nowEpoch()
  return notificationsRepo.insert({
    customer_id: args.principal.userId,
    title: args.payload.title,
    body: args.payload.body,
    type: args.payload.type ?? null,
    read: false,
    data: args.payload.data ?? null,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

/** Update a notification owned by the caller. */
export async function updateNotification(args: {
  principal: AuthPrincipal
  id: string
  payload: NotificationUpdateRequest
}): Promise<NotificationOut> {
  await getNotification({ principal: args.principal, id: args.id })
  const patch: Record<string, unknown> = { lastUpdated: nowEpoch() }
  if (args.payload.title !== undefined) patch.title = args.payload.title
  if (args.payload.body !== undefined) patch.body = args.payload.body
  if (args.payload.type !== undefined) patch.type = args.payload.type
  if (args.payload.read !== undefined) patch.read = args.payload.read
  if (args.payload.data !== undefined) patch.data = args.payload.data
  const updated = await notificationsRepo.update(args.id, patch)
  if (!updated) throw notFound('Notification not found')
  return updated
}

/** Delete a notification owned by the caller. */
export async function deleteNotification(args: {
  principal: AuthPrincipal
  id: string
}): Promise<void> {
  await getNotification({ principal: args.principal, id: args.id })
  const deleted = await notificationsRepo.remove(args.id)
  if (!deleted) throw notFound('Notification not found')
}
