import { AppError, conflict } from '@/server/core/errors'
import { hashPassword, verifyPassword } from '@/server/security/hash'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as sessions from './auth-session-service'
import type { DeviceInfo } from './auth-session-service'
import type { CustomerLogin, CustomerOut, CustomerSignupRequest } from '@/server/schemas/customer'

/**
 * Customer auth/profile business logic.
 * Ported from `customer_service.py`. No HTTP types here.
 * See: docs/migration/07-domain-endpoints.md
 */

export interface AuthResult {
  customer: CustomerOut
  accessToken: string
  refreshToken: string
  expiresIn: number
  language: 'en' | 'fr'
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

export async function signup(payload: CustomerSignupRequest, device: DeviceInfo): Promise<AuthResult> {
  const email = payload.email.toLowerCase()
  const existing = await customerRepo.findByEmail(email)
  if (existing) throw conflict('An account with this email already exists', { field: 'email' })

  const ts = nowEpoch()
  const customer = await customerRepo.insertCustomer({
    firstName: payload.firstName,
    lastName: payload.lastName,
    email,
    password: await hashPassword(payload.password),
    phoneNumber: payload.phoneNumber ?? null,
    avatarDocumentId: null,
    accountStatus: 'ACTIVE',
    loginType: 'email',
    emailVerified: false,
    preferredLanguage: 'en',
    permissionList: null,
    authProvider: 'local',
    authSubject: null,
    lastAuthAt: ts,
    dateCreated: ts,
    lastUpdated: ts,
  })

  const issued = await sessions.issueSession({ userId: customer.id, role: 'customer', device })
  return { customer, ...issued, language: customer.preferredLanguage }
}

export async function login(payload: CustomerLogin, device: DeviceInfo): Promise<AuthResult> {
  const raw = await customerRepo.findByEmail(payload.email.toLowerCase())
  if (!raw) throw invalidCredentials()
  if (!(await verifyPassword(payload.password, raw.password))) throw invalidCredentials()
  if (raw.accountStatus !== 'ACTIVE') {
    throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Account is not active', { accountStatus: raw.accountStatus })
  }

  const customer = customerRepo.toCustomerOut(raw)
  await customerRepo.updateLastAuthAt(customer.id, nowEpoch())
  const issued = await sessions.issueSession({ userId: customer.id, role: 'customer', device })
  return { customer, ...issued, language: customer.preferredLanguage }
}

export async function refresh(
  presentedToken: string,
  device: DeviceInfo,
): Promise<Omit<AuthResult, 'customer'>> {
  const rotated = await sessions.rotateRefresh({ presentedToken, device, expectedRole: 'customer' })
  const raw = await customerRepo.findById(rotated.userId)
  const language = (raw?.preferredLanguage as 'en' | 'fr') ?? 'en'
  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresIn: rotated.expiresIn,
    language,
  }
}
