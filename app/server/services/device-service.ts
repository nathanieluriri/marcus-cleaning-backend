import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as deviceRepo from '@/server/repositories/device-repo'
import type { DeviceOut, DeviceRegisterRequest } from '@/server/schemas/device'

/**
 * Push-device registration. Both apps register on login and on token refresh;
 * re-registering an existing token is idempotent by design (upsert on token).
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

function recipientRole(principal: AuthPrincipal): 'customer' | 'cleaner' {
  return principal.role === 'cleaner' ? 'cleaner' : 'customer'
}

export async function registerDevice(args: {
  principal: AuthPrincipal
  payload: DeviceRegisterRequest
}): Promise<DeviceOut> {
  const ts = nowEpoch()
  return deviceRepo.upsertByToken({
    userId: args.principal.userId,
    role: recipientRole(args.principal),
    token: args.payload.token,
    platform: args.payload.platform,
    deviceId: args.payload.deviceId ?? null,
    appVersion: args.payload.appVersion ?? null,
    locale: args.payload.locale ?? null,
    disabledAt: null,
    dateCreated: ts,
    lastUpdated: ts,
  })
}

export async function listDevices(principal: AuthPrincipal): Promise<DeviceOut[]> {
  return deviceRepo.listFor(principal.userId, recipientRole(principal))
}

/** Unregister a device (called on logout so the install stops receiving pushes). */
export async function deleteDevice(args: { principal: AuthPrincipal; id: string }): Promise<void> {
  const removed = await deviceRepo.removeById(
    args.id,
    args.principal.userId,
    recipientRole(args.principal),
  )
  if (!removed) throw notFound('Device not found')
}
