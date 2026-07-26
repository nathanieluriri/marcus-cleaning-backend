import { randomBytes } from 'node:crypto'
import { forbidden, notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as supportRepo from '@/server/repositories/support-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import { notify } from '@/server/services/notification-dispatch'
import {
  FaqEntryOut,
  type FaqAudience,
  type FaqListOut,
  type SupportTicketCreateRequest,
  type SupportTicketListOut,
  type SupportTicketOut,
} from '@/server/schemas/support'

/**
 * FAQ content (admin-editable, so copy changes without an app release) and
 * support tickets.
 */

const FAQ_ENTRIES = 'faq_entries'

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Normalise a permissive admin FAQ document. */
function toFaq(doc: Record<string, unknown>): FaqEntryOut {
  const audience = String(doc.audience ?? 'all').toLowerCase()
  return FaqEntryOut.parse({
    id: String(doc.id ?? ''),
    question: str(doc.question) ?? str(doc.title) ?? '',
    answer: str(doc.answer) ?? str(doc.body) ?? '',
    category: str(doc.category),
    audience: audience === 'staff' || audience === 'customer' ? audience : 'all',
    position: typeof doc.position === 'number' ? doc.position : 0,
  })
}

/** FAQ for an audience. `staff`/`customer` entries plus the shared `all` ones. */
export async function listFaq(audience: FaqAudience = 'all'): Promise<FaqListOut> {
  const { items } = await generic.listDocs(FAQ_ENTRIES, { limit: 200 })
  const entries = items
    .map(toFaq)
    .filter((e) => e.question && e.answer)
    .filter((e) => audience === 'all' || e.audience === 'all' || e.audience === audience)
    .sort((a, b) => a.position - b.position || a.question.localeCompare(b.question))

  const categories = [...new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c)))]
  return { items: entries, categories }
}

/** Short, human-quotable reference. Retries on the (unlikely) collision. */
async function generateReference(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = `SUP-${randomBytes(4).toString('hex').toUpperCase()}`
    if (!(await supportRepo.referenceExists(ref))) return ref
  }
  // Fall back to something guaranteed unique rather than failing the request.
  return `SUP-${Date.now().toString(36).toUpperCase()}`
}

function requesterRole(principal: AuthPrincipal): 'customer' | 'cleaner' {
  if (principal.role !== 'customer' && principal.role !== 'cleaner') {
    throw forbidden('Only customers and cleaners can raise support tickets')
  }
  return principal.role
}

export async function createTicket(args: {
  principal: AuthPrincipal
  payload: SupportTicketCreateRequest
}): Promise<SupportTicketOut> {
  const role = requesterRole(args.principal)
  const now = nowEpoch()

  const account =
    role === 'customer'
      ? await customerRepo.findById(args.principal.userId)
      : await cleanerRepo.findById(args.principal.userId)

  const ticket = await supportRepo.insert({
    reference: await generateReference(),
    requesterId: args.principal.userId,
    requesterRole: role,
    requesterEmail: account?.email ?? null,
    subject: args.payload.subject,
    message: args.payload.message,
    category: args.payload.category,
    status: 'OPEN',
    bookingId: args.payload.bookingId ?? null,
    attachmentDocumentIds: args.payload.attachmentDocumentIds,
    lastResponse: null,
    respondedAt: null,
    resolvedAt: null,
    dateCreated: now,
    lastUpdated: now,
  })

  await notify({
    userId: args.principal.userId,
    role,
    title: 'Support request received',
    body: `We have your request (${ticket.reference}) and will reply soon.`,
    type: 'support.ticket_created',
    data: { ticketId: ticket.id, reference: ticket.reference },
  })

  return ticket
}

export async function listTickets(args: {
  principal: AuthPrincipal
  cursor?: string
  pageSize?: number
}): Promise<SupportTicketListOut> {
  requesterRole(args.principal)
  return supportRepo.listForRequester({
    requesterId: args.principal.userId,
    cursor: args.cursor,
    pageSize: args.pageSize,
  })
}

export async function getTicket(args: {
  principal: AuthPrincipal
  id: string
}): Promise<SupportTicketOut> {
  const ticket = await supportRepo.getById(args.id)
  if (!ticket) throw notFound('Ticket not found')
  if (ticket.requesterId !== args.principal.userId) {
    throw forbidden('You do not have access to this ticket')
  }
  return ticket
}
