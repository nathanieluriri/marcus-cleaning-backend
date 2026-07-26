import type { Collection, Filter } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import {
  ChatMessageOut,
  type ChatMessageDoc,
  type ChatMessageOut as ChatMessageOutType,
  type ConversationDoc,
} from '@/server/schemas/chat'
import { idFilter, fromDoc } from './_helpers'

/**
 * Data access for `conversations` and `chat_messages`. Only this layer touches Mongo.
 *
 * Sequence numbers come from an atomic `$inc` on the conversation, so two
 * simultaneous sends can never claim the same slot — which is what makes
 * `after=<sequence>` polling reliable.
 */

let indexesReady = false

function conversations(): Collection<ConversationDoc> {
  return getDb().collection<ConversationDoc>('conversations')
}

function messages(): Collection<ChatMessageDoc> {
  return getDb().collection<ChatMessageDoc>('chat_messages')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await conversations().createIndex({ bookingId: 1 }, { name: 'uniq_conversation_booking', unique: true })
  await conversations().createIndex({ customerId: 1, lastMessageAt: -1 }, { name: 'idx_conversation_customer' })
  await conversations().createIndex({ cleanerId: 1, lastMessageAt: -1 }, { name: 'idx_conversation_cleaner' })
  await messages().createIndex({ conversationId: 1, sequence: 1 }, { name: 'uniq_message_sequence', unique: true })
  await messages().createIndex(
    { conversationId: 1, clientMessageId: 1 },
    { name: 'uniq_message_client_id', unique: true, sparse: true },
  )
  indexesReady = true
}

export type ConversationRow = ConversationDoc & { id: string }

function toConversation(doc: unknown): ConversationRow {
  return fromDoc(doc) as unknown as ConversationRow
}

function toMessage(doc: unknown): ChatMessageOutType {
  return ChatMessageOut.parse({ ...fromDoc(doc), attachmentUrl: null })
}

/** Create the conversation for a booking if absent, then return it. */
export async function ensureConversation(doc: ConversationDoc): Promise<ConversationRow> {
  await ensureIndexes()
  await conversations().updateOne({ bookingId: doc.bookingId }, { $setOnInsert: doc }, { upsert: true })
  const stored = await conversations().findOne({ bookingId: doc.bookingId })
  return toConversation(stored)
}

export async function findConversationById(id: string): Promise<ConversationRow | null> {
  await ensureIndexes()
  const row = await conversations().findOne(idFilter(id))
  return row ? toConversation(row) : null
}

export async function findConversationByBooking(bookingId: string): Promise<ConversationRow | null> {
  await ensureIndexes()
  const row = await conversations().findOne({ bookingId })
  return row ? toConversation(row) : null
}

/** Conversations a user participates in, most recently active first. */
export async function listConversationsFor(
  userId: string,
  role: 'customer' | 'cleaner',
): Promise<ConversationRow[]> {
  await ensureIndexes()
  const filter = role === 'customer' ? { customerId: userId } : { cleanerId: userId }
  const rows = await conversations().find(filter).sort({ lastMessageAt: -1, _id: -1 }).toArray()
  return rows.map(toConversation)
}

export async function updateConversation(
  id: string,
  set: Partial<ConversationDoc>,
): Promise<void> {
  await ensureIndexes()
  await conversations().updateOne(idFilter(id), {
    $set: { ...set, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}

/** Claim the next sequence number for a conversation, atomically. */
async function claimSequence(conversationId: string): Promise<number> {
  const updated = await conversations().findOneAndUpdate(
    idFilter(conversationId),
    { $inc: { nextSequence: 1 } },
    { returnDocument: 'before' },
  )
  return updated?.nextSequence ?? 1
}

/**
 * Append a message. When `clientMessageId` is supplied, a retried send returns
 * the message already stored rather than duplicating it.
 */
export async function insertMessage(
  doc: Omit<ChatMessageDoc, 'sequence'>,
): Promise<ChatMessageOutType> {
  await ensureIndexes()

  if (doc.clientMessageId) {
    const existing = await messages().findOne({
      conversationId: doc.conversationId,
      clientMessageId: doc.clientMessageId,
    })
    if (existing) return toMessage(existing)
  }

  const sequence = await claimSequence(doc.conversationId)
  const full: ChatMessageDoc = { ...doc, sequence }

  try {
    const result = await messages().insertOne(full)
    const stored = await messages().findOne(idFilter(String(result.insertedId)))
    return toMessage(stored)
  } catch (err) {
    // Lost a race on clientMessageId — return the winner rather than erroring.
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000 && doc.clientMessageId) {
      const existing = await messages().findOne({
        conversationId: doc.conversationId,
        clientMessageId: doc.clientMessageId,
      })
      if (existing) return toMessage(existing)
    }
    throw err
  }
}

export interface MessagePage {
  items: ChatMessageOutType[]
  hasMore: boolean
}

/** Page through a conversation, forwards (`after`) or backwards (`before`). */
export async function listMessages(args: {
  conversationId: string
  after?: number
  before?: number
  pageSize: number
}): Promise<MessagePage> {
  await ensureIndexes()
  const filter: Filter<ChatMessageDoc> & Record<string, unknown> = {
    conversationId: args.conversationId,
  }
  if (args.after != null) filter.sequence = { $gt: args.after }
  else if (args.before != null) filter.sequence = { $lt: args.before }

  // Back-scroll reads newest-first then flips, so the caller always gets
  // messages in ascending sequence order.
  const descending = args.before != null
  const rows = await messages()
    .find(filter)
    .sort({ sequence: descending ? -1 : 1 })
    .limit(args.pageSize + 1)
    .toArray()

  const hasMore = rows.length > args.pageSize
  const page = hasMore ? rows.slice(0, args.pageSize) : rows
  const items = page.map(toMessage)
  return { items: descending ? items.reverse() : items, hasMore }
}

export async function latestSequence(conversationId: string): Promise<number> {
  await ensureIndexes()
  const row = await messages()
    .find({ conversationId })
    .sort({ sequence: -1 })
    .limit(1)
    .next()
  return row?.sequence ?? 0
}

/** Messages the given user has not read (i.e. sent by the other party). */
export async function countUnread(conversationId: string, readerId: string): Promise<number> {
  await ensureIndexes()
  return messages().countDocuments({
    conversationId,
    senderId: { $ne: readerId },
    readAt: null,
  })
}

export async function lastMessage(conversationId: string): Promise<ChatMessageOutType | null> {
  await ensureIndexes()
  const row = await messages().find({ conversationId }).sort({ sequence: -1 }).limit(1).next()
  return row ? toMessage(row) : null
}

/** Stamp delivery on the other party's messages as soon as the reader fetches. */
export async function markDelivered(conversationId: string, readerId: string, at: number): Promise<void> {
  await ensureIndexes()
  await messages().updateMany(
    { conversationId, senderId: { $ne: readerId }, deliveredAt: null },
    { $set: { deliveredAt: at } },
  )
}

/** Mark the other party's messages read, optionally only up to a sequence. */
export async function markRead(
  conversationId: string,
  readerId: string,
  at: number,
  upToSequence?: number | null,
): Promise<number> {
  await ensureIndexes()
  const filter: Filter<ChatMessageDoc> & Record<string, unknown> = {
    conversationId,
    senderId: { $ne: readerId },
    readAt: null,
  }
  if (upToSequence != null) filter.sequence = { $lte: upToSequence }

  const result = await messages().updateMany(filter, {
    $set: { readAt: at, deliveredAt: at },
  })
  return result.modifiedCount
}
