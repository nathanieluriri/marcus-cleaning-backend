import { badRequest, forbidden, notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as applicationRepo from '@/server/repositories/cleaner-application-repo'
import * as documentService from '@/server/services/document-service'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import type { CleanerOnboardingStatus } from '@/server/schemas/cleaner'
import { notify } from '@/server/services/notification-dispatch'
import {
  ApplicationOut,
  EDITABLE_STATUSES,
  allowedApplicationTransitions,
  canTransitionApplication,
  missingRequirementsFor,
  type ApplicationDecisionRequest,
  type ApplicationDocumentAttachRequest,
  type ApplicationOut as ApplicationOutType,
  type ApplicationStatus,
  type ApplicationUpsertRequest,
} from '@/server/schemas/cleaner-application'
import type { ApplicationRow } from '@/server/repositories/cleaner-application-repo'

/**
 * Cleaner onboarding applications: draft upsert, document attachment, submit,
 * and the admin review decisions that drive the verification-status screen.
 *
 * Two invariants worth stating: payout tokens never leave the database (reads
 * are redacted), and status changes always go through the shared state machine
 * in the schema module rather than being set directly.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** Shape a stored row for the API: redact payout, resolve document URLs, add gates. */
async function present(row: ApplicationRow): Promise<ApplicationOutType> {
  const documents = await Promise.all(
    (row.documents ?? []).map(async (d) => {
      let url: string | null = null
      try {
        // Signed GET, scoped to the owning cleaner.
        const doc = await documentService.get(row.cleanerId, d.documentId)
        url = doc.url
      } catch {
        // A deleted or inaccessible document must not break the whole read.
        url = null
      }
      return { ...d, url }
    }),
  )

  const missing = missingRequirementsFor({
    personalDetails: row.personalDetails ?? {},
    documents: row.documents ?? [],
    serviceIds: row.serviceIds ?? [],
    availability: row.availability ?? [],
    payoutDetails: row.payoutDetails ?? null,
  })

  const canEdit = EDITABLE_STATUSES.includes(row.status)

  return ApplicationOut.parse({
    ...row,
    documents,
    payoutDetails: row.payoutDetails
      ? {
          provider: row.payoutDetails.provider,
          accountHolderName: row.payoutDetails.accountHolderName ?? null,
          bankName: row.payoutDetails.bankName ?? null,
          last4: row.payoutDetails.last4 ?? null,
          currency: row.payoutDetails.currency ?? null,
        }
      : null,
    missingRequirements: missing,
    canSubmit: canEdit && missing.length === 0,
    canEdit,
  })
}

/** Load the caller's application, creating an empty draft on first access. */
async function loadOrCreateDraft(cleanerId: string): Promise<ApplicationRow> {
  const ts = nowEpoch()
  return applicationRepo.ensureDraft({
    cleanerId,
    status: 'DRAFT',
    personalDetails: {},
    documents: [],
    serviceIds: [],
    serviceRadiusMiles: null,
    availability: [],
    payoutDetails: null,
    reviewNote: null,
    missingFields: null,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

/** Load an application by id and assert the caller owns it. */
async function loadOwned(principal: AuthPrincipal, id: string): Promise<ApplicationRow> {
  const row = await applicationRepo.findById(id)
  if (!row) throw notFound('Application not found')
  if (row.cleanerId !== principal.userId) throw forbidden('You do not have access to this application')
  return row
}

/** The caller's application (creates the draft if they have never started one). */
export async function getMyApplication(principal: AuthPrincipal): Promise<ApplicationOutType> {
  return present(await loadOrCreateDraft(principal.userId))
}

export async function getApplication(
  principal: AuthPrincipal,
  id: string,
): Promise<ApplicationOutType> {
  return present(await loadOwned(principal, id))
}

/**
 * Create or patch the draft. Each wizard step sends only its own fields, so
 * absent keys are left untouched rather than cleared.
 */
export async function upsertApplication(args: {
  principal: AuthPrincipal
  payload: ApplicationUpsertRequest
  /** Omitted by `POST /applications`; supplied by the id-scoped variant. */
  id?: string
}): Promise<ApplicationOutType> {
  const row = args.id
    ? await loadOwned(args.principal, args.id)
    : await loadOrCreateDraft(args.principal.userId)

  if (!EDITABLE_STATUSES.includes(row.status)) {
    throw badRequest(`An application in ${row.status} cannot be edited`, {
      status: row.status,
      editableIn: EDITABLE_STATUSES,
    })
  }

  const set: Record<string, unknown> = {}
  if (args.payload.personalDetails) {
    // Merge so step 1 can be revisited field by field.
    set.personalDetails = { ...(row.personalDetails ?? {}), ...args.payload.personalDetails }
  }
  if (args.payload.serviceIds !== undefined) set.serviceIds = args.payload.serviceIds
  if (args.payload.serviceRadiusMiles !== undefined) set.serviceRadiusMiles = args.payload.serviceRadiusMiles
  if (args.payload.availability !== undefined) set.availability = args.payload.availability
  if (args.payload.payoutDetails !== undefined) set.payoutDetails = args.payload.payoutDetails

  const updated = await applicationRepo.update(row.id, set)
  return present(updated!)
}

/**
 * Attach an already-uploaded document. The upload itself goes straight to
 * storage via a presigned URL (`POST /v1/documents/upload-intents`); this only
 * records the reference, after verifying the caller owns the document and the
 * bytes actually landed.
 */
export async function attachDocument(args: {
  principal: AuthPrincipal
  id: string
  payload: ApplicationDocumentAttachRequest
}): Promise<ApplicationOutType> {
  const row = await loadOwned(args.principal, args.id)
  if (!EDITABLE_STATUSES.includes(row.status)) {
    throw badRequest(`An application in ${row.status} cannot be edited`, { status: row.status })
  }

  // Throws 404/403 if the document is missing or belongs to someone else.
  const doc = await documentService.get(args.principal.userId, args.payload.documentId)
  if (doc.status !== 'UPLOADED') {
    throw badRequest('Finish the upload before attaching it', {
      documentId: doc.id,
      status: doc.status,
    })
  }

  const updated = await applicationRepo.attachDocument(row.id, {
    documentId: doc.id,
    kind: args.payload.kind,
    fileName: doc.fileName,
    contentType: doc.contentType,
    uploadedAt: nowEpoch(),
  })
  return present(updated!)
}

/** Submit for review. Blocked until every requirement is satisfied. */
export async function submitApplication(args: {
  principal: AuthPrincipal
  id: string
}): Promise<ApplicationOutType> {
  const row = await loadOwned(args.principal, args.id)

  if (!canTransitionApplication(row.status, 'SUBMITTED')) {
    throw badRequest(`Cannot submit an application in ${row.status}`, {
      status: row.status,
      allowed: allowedApplicationTransitions(row.status),
    })
  }

  const missing = missingRequirementsFor({
    personalDetails: row.personalDetails ?? {},
    documents: row.documents ?? [],
    serviceIds: row.serviceIds ?? [],
    availability: row.availability ?? [],
    payoutDetails: row.payoutDetails ?? null,
  })
  if (missing.length > 0) {
    throw badRequest('Your application is incomplete', { missingRequirements: missing })
  }

  const submittedAt = nowEpoch()
  const updated = await applicationRepo.update(row.id, {
    status: 'SUBMITTED',
    submittedAt,
    reviewNote: null,
    missingFields: null,
  })
  await cleanerRepo.updateCleaner(row.cleanerId, {
    onboardingStatus: 'PENDING_REVIEW',
    lastUpdated: submittedAt,
  })

  await notify({
    userId: row.cleanerId,
    role: 'cleaner',
    title: 'Application submitted',
    body: 'We have received your application and will review it shortly.',
    type: 'application.submitted',
    data: { applicationId: row.id },
  })

  return present(updated!)
}

// --- admin side -------------------------------------------------------------

/** Review queue for admins. */
export async function listQueue(args: {
  statuses?: ApplicationStatus[]
  limit?: number
  skip?: number
}): Promise<{ items: ApplicationOutType[]; total: number }> {
  const statuses = args.statuses ?? ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED']
  const result = await applicationRepo.listByStatus(statuses, args.limit, args.skip)
  const items = await Promise.all(result.items.map(present))
  return { items, total: result.total }
}

/**
 * Map the admin's `missingFields` onto the wizard step the cleaner must return
 * to. The first matching field wins — sending them to the earliest incomplete
 * step is less confusing than picking an arbitrary one.
 */
export function wizardStepFor(
  missingFields: string[] | null | undefined,
): 'documents' | 'services' | 'availability' | 'payout' | 'personal' | null {
  if (!missingFields?.length) return null
  const has = (prefix: string) => missingFields.some((f) => f.startsWith(prefix))

  if (has('personalDetails')) return 'personal'
  if (has('documents')) return 'documents'
  if (has('serviceIds') || has('serviceRadius')) return 'services'
  if (has('availability')) return 'availability'
  if (has('payoutDetails')) return 'payout'
  return null
}

const DECISION_TO_STATUS: Record<ApplicationDecisionRequest['decision'], ApplicationStatus> = {
  START_REVIEW: 'UNDER_REVIEW',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_MORE_INFO: 'MORE_INFO_REQUIRED',
}

const DECISION_MESSAGE: Record<ApplicationStatus, { title: string; body: string }> = {
  DRAFT: { title: 'Application reopened', body: 'Your application is editable again.' },
  SUBMITTED: { title: 'Application submitted', body: 'Your application has been submitted.' },
  UNDER_REVIEW: { title: 'Application under review', body: 'We are reviewing your application now.' },
  MORE_INFO_REQUIRED: {
    title: 'More information needed',
    body: 'We need a few more details before we can approve your application.',
  },
  APPROVED: { title: 'You are approved', body: 'Your application was approved — you can start accepting jobs.' },
  REJECTED: { title: 'Application not approved', body: 'Unfortunately we could not approve your application.' },
}

/**
 * Apply an admin decision. Approving also flips the cleaner's onboarding state
 * so the guards that gate job access see an approved cleaner.
 */
export async function decideApplication(args: {
  principal: AuthPrincipal
  id: string
  payload: ApplicationDecisionRequest
}): Promise<ApplicationOutType> {
  const row = await applicationRepo.findById(args.id)
  if (!row) throw notFound('Application not found')

  const target = DECISION_TO_STATUS[args.payload.decision]
  if (!canTransitionApplication(row.status, target)) {
    throw badRequest(`Cannot move an application from ${row.status} to ${target}`, {
      from: row.status,
      to: target,
      allowed: allowedApplicationTransitions(row.status),
    })
  }

  const now = nowEpoch()
  const updated = await applicationRepo.update(row.id, {
    status: target,
    reviewNote: args.payload.note ?? null,
    missingFields: args.payload.missingFields ?? null,
    reviewedAt: now,
    reviewedBy: args.principal.userId,
  })

  const missingStep = wizardStepFor(args.payload.missingFields)

  // Keep the cleaner account's onboarding state in step with the application,
  // since the job-access guards read the account, not the application.
  const ONBOARDING: Partial<Record<ApplicationStatus, CleanerOnboardingStatus>> = {
    UNDER_REVIEW: 'PENDING_REVIEW',
    MORE_INFO_REQUIRED: 'IN_PROGRESS',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  }
  const onboardingStatus = ONBOARDING[target]
  if (onboardingStatus) {
    await cleanerRepo.updateCleaner(row.cleanerId, { onboardingStatus, lastUpdated: now })
  }

  const message = DECISION_MESSAGE[target]
  await notify({
    userId: row.cleanerId,
    role: 'cleaner',
    title: message.title,
    body: args.payload.note ?? message.body,
    type: `application.${target.toLowerCase()}`,
    data: {
      applicationId: row.id,
      status: target,
      // Lets the staff app deep-link to the wizard step that needs work rather
      // than dumping the cleaner on a generic status screen.
      ...(missingStep ? { missingStep } : {}),
    },
  })

  return present(updated!)
}
