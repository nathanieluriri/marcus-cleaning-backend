import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomerOrCleaner, principalOf } from '@/server/security/guards'
import {
  ChatMessageOut,
  ChatMessageSendRequest,
  ConversationListOut,
  ConversationOut,
  MessageListOut,
  MessageListQuery,
  ReadReceiptRequest,
} from '@/server/schemas/chat'
import * as chatService from '@/server/services/chat-service'

/**
 * /v1/conversations — customer <-> cleaner chat.
 * Mounted under /api/v1/conversations (see server/app.ts).
 *
 * v1 transport is polling: `GET /{id}/messages?after=<latestSequence>` every
 * `pollIntervalSeconds` (returned in the payload). Both apps share this router.
 */

export const chat = createRouter()

const errs = {
  400: { description: 'Bad request', content: { 'application/json': { schema: ErrorEnvelope } } },
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const IdParam = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

const OpenConversationRequest = z
  .object({ bookingId: z.string().min(1) })
  .openapi('OpenConversationRequest')

chat.use('*', requireCustomerOrCleaner())

// GET / — the caller's conversations + total unread badge
chat.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Conversations', content: { 'application/json': { schema: envelopeOf(ConversationListOut) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const result = await chatService.listConversations(principalOf(c))
    return c.json(ok(c, 'Conversations fetched successfully', result), 200)
  },
)

// POST / — open (or reopen) the conversation for a booking
chat.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: OpenConversationRequest } } } },
    responses: {
      200: { description: 'Conversation', content: { 'application/json': { schema: envelopeOf(ConversationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { bookingId } = c.req.valid('json')
    const conversation = await chatService.openConversationForBooking({
      principal: principalOf(c),
      bookingId,
    })
    return c.json(ok(c, 'Conversation opened successfully', conversation), 200)
  },
)

// GET /{id}
chat.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Conversation', content: { 'application/json': { schema: envelopeOf(ConversationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const conversation = await chatService.getConversation({
      principal: principalOf(c),
      conversationId: id,
    })
    return c.json(ok(c, 'Conversation fetched successfully', conversation), 200)
  },
)

// GET /{id}/messages — history and polling
chat.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/messages',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, query: MessageListQuery },
    responses: {
      200: { description: 'Messages', content: { 'application/json': { schema: envelopeOf(MessageListOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await chatService.listMessages({
      principal: principalOf(c),
      conversationId: id,
      query: c.req.valid('query'),
    })
    return c.json(ok(c, 'Messages fetched successfully', result), 200)
  },
)

// POST /{id}/messages — send
chat.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/messages',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ChatMessageSendRequest } } } },
    responses: {
      201: { description: 'Message sent', content: { 'application/json': { schema: envelopeOf(ChatMessageOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const message = await chatService.sendMessage({
      principal: principalOf(c),
      conversationId: id,
      payload: c.req.valid('json'),
    })
    return c.json(ok(c, 'Message sent successfully', message), 201)
  },
)

// POST /{id}/read — read receipt
chat.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Chat'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam, body: { content: { 'application/json': { schema: ReadReceiptRequest } } } },
    responses: {
      200: {
        description: 'Marked read',
        content: {
          'application/json': {
            schema: envelopeOf(z.object({ updated: z.number().int(), unreadCount: z.number().int() })),
          },
        },
      },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const { upToSequence } = c.req.valid('json')
    const result = await chatService.markRead({
      principal: principalOf(c),
      conversationId: id,
      upToSequence,
    })
    return c.json(ok(c, 'Conversation marked as read', result), 200)
  },
)
