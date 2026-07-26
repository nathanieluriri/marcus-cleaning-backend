import { z } from '@hono/zod-openapi'

/**
 * Customer <-> cleaner chat (`conversations` + `chat_messages`).
 *
 * Transport for v1 is REST with polling — `GET /messages?after=` returns only
 * what is new, so a 5s poll is cheap. The message model carries the fields a
 * socket transport would need later (per-message ids, monotonic `sequence`,
 * delivery + read stamps), so moving to push does not change the payloads.
 *
 * A conversation is always scoped to a booking: the two parties can talk about
 * the job they share, and nothing else.
 */

export const ChatParticipantRole = z.enum(['customer', 'cleaner'])
export type ChatParticipantRole = z.infer<typeof ChatParticipantRole>

export const ChatMessageOut = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    /** Monotonic within a conversation; use as the `after` cursor when polling. */
    sequence: z.number().int().openapi({ example: 42 }),
    senderId: z.string(),
    senderRole: ChatParticipantRole,
    body: z.string(),
    /** Attachment document id (uploaded via /v1/documents), if any. */
    attachmentDocumentId: z.string().nullable().default(null),
    attachmentUrl: z.string().nullable().default(null),
    /** Set once the recipient has fetched it. */
    deliveredAt: z.number().int().nullable().default(null),
    readAt: z.number().int().nullable().default(null),
    dateCreated: z.number().int().nullable().default(null),
  })
  .openapi('ChatMessageOut')
export type ChatMessageOut = z.infer<typeof ChatMessageOut>

export const ChatMessageSendRequest = z
  .object({
    body: z.string().min(1).max(4000),
    attachmentDocumentId: z.string().nullable().optional(),
    /**
     * Client-generated id, echoed back so the app can reconcile its optimistic
     * message. Also makes a retried send idempotent within the conversation.
     */
    clientMessageId: z.string().max(100).nullable().optional(),
  })
  .openapi('ChatMessageSendRequest')
export type ChatMessageSendRequest = z.infer<typeof ChatMessageSendRequest>

export const ConversationOut = z
  .object({
    id: z.string(),
    bookingId: z.string(),
    customerId: z.string(),
    cleanerId: z.string(),
    /** Display name of the OTHER party, from the caller's point of view. */
    counterpartName: z.string().nullable().default(null),
    counterpartAvatarUrl: z.string().nullable().default(null),
    lastMessage: ChatMessageOut.nullable().default(null),
    /** Unread count for the CALLER. */
    unreadCount: z.number().int().default(0),
    /** False once the booking is finished — history stays readable. */
    active: z.boolean().default(true),
    dateCreated: z.number().int().nullable().default(null),
    lastUpdated: z.number().int().nullable().default(null),
  })
  .openapi('ConversationOut')
export type ConversationOut = z.infer<typeof ConversationOut>

export const ConversationListOut = z
  .object({
    items: z.array(ConversationOut),
    totalUnread: z.number().int().default(0),
  })
  .openapi('ConversationListOut')
export type ConversationListOut = z.infer<typeof ConversationListOut>

export const MessageListQuery = z
  .object({
    /** Return messages with `sequence` greater than this. Use for polling. */
    after: z.coerce.number().int().optional(),
    /** Return messages with `sequence` less than this. Use for back-scroll. */
    before: z.coerce.number().int().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .openapi('MessageListQuery')
export type MessageListQuery = z.infer<typeof MessageListQuery>

export const MessageListOut = z
  .object({
    items: z.array(ChatMessageOut),
    /** Highest sequence in this conversation — poll with `after=latestSequence`. */
    latestSequence: z.number().int(),
    hasMore: z.boolean().default(false),
    /** Recommended poll interval while the chat screen is open, in seconds. */
    pollIntervalSeconds: z.number().int().default(5),
  })
  .openapi('MessageListOut')
export type MessageListOut = z.infer<typeof MessageListOut>

export const ReadReceiptRequest = z
  .object({
    /** Mark everything up to and including this sequence as read. */
    upToSequence: z.number().int().nullable().optional(),
  })
  .openapi('ReadReceiptRequest')
export type ReadReceiptRequest = z.infer<typeof ReadReceiptRequest>

// --- internal DB documents -------------------------------------------------

export interface ConversationDoc {
  bookingId: string
  customerId: string
  cleanerId: string
  /** Next sequence to hand out; incremented atomically on send. */
  nextSequence: number
  lastMessageAt?: number | null
  lastMessagePreview?: string | null
  active: boolean
  dateCreated: number
  lastUpdated: number
}

export interface ChatMessageDoc {
  conversationId: string
  sequence: number
  senderId: string
  senderRole: ChatParticipantRole
  body: string
  attachmentDocumentId?: string | null
  clientMessageId?: string | null
  deliveredAt?: number | null
  readAt?: number | null
  dateCreated: number
}
