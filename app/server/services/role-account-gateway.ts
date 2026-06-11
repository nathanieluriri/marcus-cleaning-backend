import type { Role } from '@/server/security/principal'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as adminRepo from '@/server/repositories/admin-repo'

/**
 * Unified account lookup across the three role collections.
 * Ported from `services/role_account_gateway.py`.
 */

export interface AccountSnapshot {
  id: string
  accountStatus: string
  preferredLanguage: 'en' | 'fr'
}

export async function retrieveAccountById(role: Role, userId: string): Promise<AccountSnapshot | null> {
  if (role === 'customer') {
    const doc = await customerRepo.findById(userId)
    return doc ? { id: userId, accountStatus: doc.accountStatus, preferredLanguage: doc.preferredLanguage } : null
  }
  if (role === 'cleaner') {
    const doc = await cleanerRepo.findById(userId)
    return doc ? { id: userId, accountStatus: doc.accountStatus, preferredLanguage: doc.preferredLanguage } : null
  }
  const doc = await adminRepo.findById(userId)
  return doc ? { id: userId, accountStatus: doc.accountStatus, preferredLanguage: doc.preferredLanguage } : null
}
