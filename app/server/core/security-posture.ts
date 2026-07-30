import { getSettings } from './settings'

/**
 * Boot-time production safety check. Called once from `app.ts` module scope.
 *
 * `OTP_DEV_CODE` lets non-prod environments bypass the OTP challenge with a
 * fixed code for fast local/staging testing. It must NEVER be set in
 * production — if it is, refuse to boot rather than silently ship a 2FA
 * bypass. See: docs/superpowers/plans/2026-07-29-admin-platform-backend.md
 */
export function assertProductionPosture(): void {
  const s = getSettings()
  if (s.NODE_ENV === 'production' && s.OTP_DEV_CODE) {
    throw new Error(
      'Refusing to boot: OTP_DEV_CODE must not be set in production (it bypasses admin 2FA).',
    )
  }
}
