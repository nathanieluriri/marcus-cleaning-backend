import { badRequest, forbidden, notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadViewableBooking } from '@/server/security/booking-access'
import * as chatRepo from '@/server/repositories/chat-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as documentService from '@/server/services/document-service'
import { push } from '@/server/services/notification-dispatch'
import type {
  ChatMessageOut,
  ChatMessageSendRequest,
  ConversationListOut,
  ConversationOut,
  MessageListOut,
  MessageListQuery,
} from '@/server/schemas/chat'
import type { ConversationRow } from '@/server/repositories/chat-repo'

/**
 * Chat between the customer and the assigned cleaner on a booking.
 *
 * Access follows the booking: whoever may view the booking may use its
 * conversation, and nobody else. A conversation cannot exist before a cleaner
 * is assigned, because until then there is no second party.
 *
 * Delivery model: the poller marks the other party's messages delivered on
 * fetch, and read when the screen reports it. Both stamps live on the message,
 * so a future socket transport can emit them without a schema change.
 */

/** How often the client should poll while the chat screen is open. */
const POLL_INTERVAL_SECONDS = 5

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function roleOf(principal: AuthPrincipal): 'customer' | 'cleaner' {
  if (principal.role !== 'customer' && principal.role !== 'cleaner') {
    throw forbidden('Only customers and cleaners can use chat')
  }
  return principal.role
}

/** Assert the caller is one of the two participants. */
function assertParticipant(principal: AuthPrincipal, conversation: ConversationRow): void {
  const isParticipant =
    (principal.role === 'customer' && conversation.customerId === principal.userId) ||
    (principal.role === 'cleaner' && conversation.cleanerId === principal.userId)
  if (!isParticipant) throw forbidden('You are not a participant in this conversation')
}

async function counterpartOf(
  principal: AuthPrincipal,
  conversation: ConversationRow,
): Promise<{ name: string | null; avatarUrl: string | null; id: string; role: 'customer' | 'cleaner' }> {
  if (roleOf(principal) === 'customer') {
    const cleaner = await cleanerRepo.findById(conversation.cleanerId)
    return {
      id: conversation.cleanerId,
      role: 'cleaner',
      name: cleaner ? `${cleaner.firstName} ${cleaner.lastName}`.trim() : null,
      avatarUrl: null,
    }
  }
  const customer = await customerRepo.findById(conversation.customerId)
  return {
    id: conversation.customerId,
    role: 'customer',
    name: customer ? `${customer.firstName} ${customer.lastName}`.trim() : null,
    avatarUrl: null,
  }
}

async function present(
  principal: AuthPrincipal,
  conversation: ConversationRow,
): Promise<ConversationOut> {
  const [counterpart, unreadCount, last] = await Promise.all([
    counterpartOf(principal, conversation),
    chatRepo.countUnread(conversation.id, principal.userId),
    chatRepo.lastMessage(conversation.id),
  ])

  return {
    id: conversation.id,
    bookingId: conversation.bookingId,
    customerId: conversation.customerId,
    cleanerId: conversation.cleanerId,
    counterpartName: counterpart.name,
    counterpartAvatarUrl: counterpart.avatarUrl,
    lastMessage: last,
    unreadCount,
    active: conversation.active,
    dateCreated: conversation.dateCreated,
    lastUpdated: conversation.lastUpdated,
  }
}

/**
 * Open (or reopen) the conversation for a booking. Called by the app when the
 * chat screen mounts; safe to call repeatedly.
 */
export async function openConversationForBooking(args: {
  principal: AuthPrincipal
  bookingId: string
}): Promise<ConversationOut> {
  const booking = await loadViewableBooking(args.principal, args.bookingId)
  if (!booking.cleaner_id) {
    throw badRequest('Chat opens once a cleaner is assigned to this booking', {
      bookingId: booking.id,
    })
  }

  const ts = nowEpoch()
  const conversation = await chatRepo.ensureConversation({
    bookingId: booking.id,
    customerId: booking.customer_id,
    cleanerId: booking.cleaner_id,
    nextSequence: 1,
    lastMessageAt: null,
    lastMessagePreview: null,
    // Closed conversations stay readable; only new sends are blocked.
    active: booking.status !== 'CANCELLED' && booking.status !== 'ACKNOWLEDGED',
    dateCreated: ts,
    lastUpdated: ts,
  })

  assertParticipant(args.principal, conversation)
  return present(args.principal, conversation)
}

/** Every conversation the caller participates in, plus a total unread badge. */
export async function listConversations(principal: AuthPrincipal): Promise<ConversationListOut> {
  const rows = await chatRepo.listConversationsFor(principal.userId, roleOf(principal))
  const items = await Promise.all(rows.map((row) => present(principal, row)))
  return { items, totalUnread: items.reduce((sum, c) => sum + c.unreadCount, 0) }
}

async function loadConversation(
  principal: AuthPrincipal,
  conversationId: string,
): Promise<ConversationRow> {
  const conversation = await chatRepo.findConversationById(conversationId)
  if (!conversation) throw notFound('Conversation not found')
  assertParticipant(principal, conversation)
  return conversation
}

export async function getConversation(args: {
  principal: AuthPrincipal
  conversationId: string
}): Promise<ConversationOut> {
  return present(args.principal, await loadConversation(args.principal, args.conversationId))
}

/** Resolve attachment URLs for a page of messages. */
async function withAttachmentUrls(
  ownerId: string,
  items: ChatMessageOut[],
): Promise<ChatMessageOut[]> {
  return Promise.all(
    items.map(async (m) => {
      if (!m.attachmentDocumentId) return m
      try {
        const doc = await documentService.get(ownerId, m.attachmentDocumentId)
        return { ...m, attachmentUrl: doc.url }
      } catch {
        // The sender owns the document, so the recipient's signed read may fail.
        // A missing URL is better than a failed message list.
        return m
      }
    }),
  )
}

/**
 * Message history / poll. Fetching also marks the other party's messages as
 * delivered — that is the closest thing to a delivery receipt REST can offer.
 */
export async function listMessages(args: {
  principal: AuthPrincipal
  conversationId: string
  query: MessageListQuery
}): Promise<MessageListOut> {
  const conversation = await loadConversation(args.principal, args.conversationId)
  const now = nowEpoch()

  const page = await chatRepo.listMessages({
    conversationId: conversation.id,
    after: args.query.after,
    before: args.query.before,
    pageSize: args.query.pageSize,
  })

  await chatRepo.markDelivered(conversation.id, args.principal.userId, now)
  const latest = await chatRepo.latestSequence(conversation.id)

  return {
    items: await withAttachmentUrls(args.principal.userId, page.items),
    latestSequence: latest,
    hasMore: page.hasMore,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  }
}

/** Send a message and push it to the other party. */
export async function sendMessage(args: {
  principal: AuthPrincipal
  conversationId: string
  payload: ChatMessageSendRequest
}): Promise<ChatMessageOut> {
  const conversation = await loadConversation(args.principal, args.conversationId)
  if (!conversation.active) throw badRequest('This conversation is closed')

  const role = roleOf(args.principal)
  const now = nowEpoch()

  if (args.payload.attachmentDocumentId) {
    // 404/403 if it is not the sender's document.
    await documentService.get(args.principal.userId, args.payload.attachmentDocumentId)
  }

  const message = await chatRepo.insertMessage({
    conversationId: conversation.id,
    senderId: args.principal.userId,
    senderRole: role,
    body: args.payload.body,
    attachmentDocumentId: args.payload.attachmentDocumentId ?? null,
    clientMessageId: args.payload.clientMessageId ?? null,
    deliveredAt: null,
    readAt: null,
    dateCreated: now,
  })

  await chatRepo.updateConversation(conversation.id, {
    lastMessageAt: now,
    lastMessagePreview: args.payload.body.slice(0, 140),
  })

  // Chat pushes deliberately do NOT create a notification row — the chat screen
  // is the inbox, and duplicating every message into the bell would bury it.
  const counterpart = await counterpartOf(args.principal, conversation)
  const senderName =
    role === 'customer'
      ? (await customerRepo.findById(args.principal.userId))
      : (await cleanerRepo.findById(args.principal.userId))
  await push(counterpart.id, counterpart.role, {
    title: senderName ? `${senderName.firstName} ${senderName.lastName}`.trim() : 'New message',
    body: args.payload.body.slice(0, 140),
    data: {
      type: 'chat.message',
      conversationId: conversation.id,
      bookingId: conversation.bookingId,
      sequence: String(message.sequence),
    },
  })

  return message
}

/** Mark the other party's messages read. Returns the new unread count (0 or partial). */
export async function markRead(args: {
  principal: AuthPrincipal
  conversationId: string
  upToSequence?: number | null
}): Promise<{ updated: number; unreadCount: number }> {
  const conversation = await loadConversation(args.principal, args.conversationId)
  const now = nowEpoch()
  const updated = await chatRepo.markRead(
    conversation.id,
    args.principal.userId,
    now,
    args.upToSequence,
  )
  const unreadCount = await chatRepo.countUnread(conversation.id, args.principal.userId)
  return { updated, unreadCount }
}
