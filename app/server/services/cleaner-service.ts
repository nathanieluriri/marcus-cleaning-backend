import { AppError, conflict, notFound } from '@/server/core/errors'
import { hashPassword, verifyPassword } from '@/server/security/hash'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as sessions from './auth-session-service'
import type { DeviceInfo } from './auth-session-service'
import type { CleanerLogin, CleanerOnboardingUpdate, CleanerOut, CleanerSignupRequest } from '@/server/schemas/cleaner'

/** Cleaner auth/onboarding business logic. Ported from `cleaner_service.py`. */

export interface CleanerAuthResult {
  cleaner: CleanerOut
  accessToken: string
  refreshToken: string
  expiresIn: number
  language: 'en' | 'fr'
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')
const nowEpoch = () => Math.floor(Date.now() / 1000)

export async function signup(payload: CleanerSignupRequest, device: DeviceInfo): Promise<CleanerAuthResult> {
  const email = payload.email.toLowerCase()
  if (await cleanerRepo.findByEmail(email)) throw conflict('An account with this email already exists', { field: 'email' })

  const ts = nowEpoch()
  const cleaner = await cleanerRepo.insertCleaner({
    firstName: payload.firstName,
    lastName: payload.lastName,
    email,
    password: await hashPassword(payload.password),
    phoneNumber: payload.phoneNumber ?? null,
    accountStatus: 'ACTIVE',
    loginType: 'email',
    onboardingStatus: 'NOT_STARTED',
    allowAdminSelection: false,
    emailVerified: false,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: 'local',
    authSubject: null,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })

  const issued = await sessions.issueSession({ userId: cleaner.id, role: 'cleaner', device })
  return { cleaner, ...issued, language: cleaner.preferredLanguage }
}

export async function login(payload: CleanerLogin, device: DeviceInfo): Promise<CleanerAuthResult> {
  const raw = await cleanerRepo.findByEmail(payload.email.toLowerCase())
  if (!raw) throw invalidCredentials()
  if (!(await verifyPassword(payload.password, raw.password))) throw invalidCredentials()
  if (raw.accountStatus !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Account is not active', { accountStatus: raw.accountStatus })
  }
  const cleaner = cleanerRepo.toCleanerOut(raw)
  await cleanerRepo.updateLastAuthAt(cleaner.id, nowEpoch())
  const issued = await sessions.issueSession({ userId: cleaner.id, role: 'cleaner', device })
  return { cleaner, ...issued, language: cleaner.preferredLanguage }
}

export async function refresh(presentedToken: string, device: DeviceInfo): Promise<Omit<CleanerAuthResult, 'cleaner'>> {
  const rotated = await sessions.rotateRefresh({ presentedToken, device, expectedRole: 'cleaner' })
  const raw = await cleanerRepo.findById(rotated.userId)
  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresIn: rotated.expiresIn,
    language: (raw?.preferredLanguage as 'en' | 'fr') ?? 'en',
  }
}

export async function updateOnboarding(cleanerId: string, patch: CleanerOnboardingUpdate): Promise<CleanerOut> {
  const updated = await cleanerRepo.updateCleaner(cleanerId, {
    bio: patch.bio,
    skills: patch.skills,
    equipment: patch.equipment,
    serviceAreaIds: patch.serviceAreaIds,
    allowAdminSelection: patch.allowAdminSelection,
    onboardingStatus: 'PENDING_REVIEW',
  })
  if (!updated) throw notFound('Cleaner not found')
  return updated
}
