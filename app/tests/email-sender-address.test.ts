import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

/**
 * The Resend sender address: `RESEND_FROM_EMAIL` first, `EMAIL_FROM` second,
 * built-in placeholder last.
 *
 * `RESEND_FROM_EMAIL` is the name Resend's own docs use, so it is the one
 * deployments already have set; `EMAIL_FROM` predates it here and must keep
 * working. Getting this wrong is not subtle — Resend rejects the placeholder
 * sender outright, which takes down the admin login OTP with it.
 *
 * The Resend client is mocked so `dispatch()` runs for real and we can assert
 * on the exact `from` handed to the SDK.
 */

/** The shape `dispatch()` hands the Resend SDK — typed so `mock.calls` is too. */
type ResendPayload = { from: string; to: string[]; subject: string; react: unknown }
type ResendOptions = { idempotencyKey: string }
type ResendResult = { data: { id: string } | null; error: unknown }

const sendImpl = vi.fn<(payload: ResendPayload, options: ResendOptions) => Promise<ResendResult>>(async () => ({
  data: { id: 'msg_test' },
  error: null,
}))

vi.mock('@/server/core/email/resend', () => ({
  getResend: vi.fn(() => ({ emails: { send: sendImpl } })),
}))

import {
  DEFAULT_EMAIL_FROM,
  resolveEmailFrom,
  resolveEmailFromWithSource,
  __resetSettingsCache,
} from '@/server/core/settings'
import { sendOtpEmail } from '@/server/core/email/send'

const RESEND_NAME = 'Marcus Cleaning <no-reply@resend-var.example.com>'
const LEGACY_NAME = 'Marcus Cleaning <no-reply@legacy-var.example.com>'

const MANAGED_KEYS = ['RESEND_FROM_EMAIL', 'EMAIL_FROM'] as const
const originalEnv: Record<string, string | undefined> = {}
for (const k of MANAGED_KEYS) originalEnv[k] = process.env[k]

/** The settings schema still has to parse, so seed the required trio. */
function seedRequiredEnv() {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
  process.env.STORAGE_BACKEND ??= 'local'
  process.env.RESEND_API_KEY ??= 're_test_key'
}

beforeEach(() => {
  vi.clearAllMocks()
  sendImpl.mockResolvedValue({ data: { id: 'msg_test' }, error: null })
  for (const k of MANAGED_KEYS) delete process.env[k]
  seedRequiredEnv()
  __resetSettingsCache()
})

afterAll(() => {
  for (const k of MANAGED_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(originalEnv)) if (v !== undefined) process.env[k] = v
  __resetSettingsCache()
})

describe('resolveEmailFrom', () => {
  it('prefers RESEND_FROM_EMAIL when both are set', () => {
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: RESEND_NAME, EMAIL_FROM: LEGACY_NAME })).toBe(RESEND_NAME)
  })

  it('uses RESEND_FROM_EMAIL when it is the only one set', () => {
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: RESEND_NAME })).toBe(RESEND_NAME)
  })

  it('still uses EMAIL_FROM when only the legacy var is set', () => {
    expect(resolveEmailFrom({ EMAIL_FROM: LEGACY_NAME })).toBe(LEGACY_NAME)
  })

  it('falls back to the built-in placeholder when neither is set', () => {
    expect(resolveEmailFrom({})).toBe(DEFAULT_EMAIL_FROM)
  })

  it('treats a blank or whitespace-only value as unset', () => {
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: '', EMAIL_FROM: LEGACY_NAME })).toBe(LEGACY_NAME)
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: '   ', EMAIL_FROM: LEGACY_NAME })).toBe(LEGACY_NAME)
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: '  ', EMAIL_FROM: '  ' })).toBe(DEFAULT_EMAIL_FROM)
  })

  it('trims surrounding whitespace off the resolved address', () => {
    expect(resolveEmailFrom({ RESEND_FROM_EMAIL: `  ${RESEND_NAME}  ` })).toBe(RESEND_NAME)
  })

  it('never returns an empty string', () => {
    for (const c of [{}, { RESEND_FROM_EMAIL: '' }, { EMAIL_FROM: '' }, { RESEND_FROM_EMAIL: ' ', EMAIL_FROM: ' ' }]) {
      expect(resolveEmailFrom(c).length).toBeGreaterThan(0)
    }
  })
})

describe('resolveEmailFromWithSource', () => {
  it('names RESEND_FROM_EMAIL as the source when it wins', () => {
    expect(resolveEmailFromWithSource({ RESEND_FROM_EMAIL: RESEND_NAME, EMAIL_FROM: LEGACY_NAME })).toEqual({
      value: RESEND_NAME,
      source: 'RESEND_FROM_EMAIL',
    })
  })

  it('names EMAIL_FROM as the source when only it is set', () => {
    expect(resolveEmailFromWithSource({ EMAIL_FROM: LEGACY_NAME })).toEqual({
      value: LEGACY_NAME,
      source: 'EMAIL_FROM',
    })
  })

  it('reports "default" when neither is set', () => {
    expect(resolveEmailFromWithSource({})).toEqual({ value: DEFAULT_EMAIL_FROM, source: 'default' })
  })

  it('reports "default" when the winning var merely restates the placeholder', () => {
    // Setting the placeholder explicitly is no better than leaving it unset —
    // Resend rejects it either way, so it must not read as "configured".
    expect(resolveEmailFromWithSource({ RESEND_FROM_EMAIL: DEFAULT_EMAIL_FROM, EMAIL_FROM: LEGACY_NAME }).source).toBe(
      'default',
    )
    expect(resolveEmailFromWithSource({ EMAIL_FROM: DEFAULT_EMAIL_FROM }).source).toBe('default')
  })

  it('accepts a full parsed Settings object, not just the two keys', () => {
    // Guards the call site in send.ts: resolveEmailFrom(getSettings()).
    const settingsLike = { NODE_ENV: 'test', RESEND_API_KEY: 'k', EMAIL_FROM: LEGACY_NAME }
    expect(resolveEmailFrom(settingsLike)).toBe(LEGACY_NAME)
  })
})

describe('send helpers pass the resolved sender to Resend', () => {
  /** The `from` the Resend SDK actually received on the last send. */
  function lastFrom(): string {
    expect(sendImpl).toHaveBeenCalledTimes(1)
    return sendImpl.mock.calls[0][0].from
  }

  it('uses RESEND_FROM_EMAIL when both vars are set', async () => {
    process.env.RESEND_FROM_EMAIL = RESEND_NAME
    process.env.EMAIL_FROM = LEGACY_NAME
    __resetSettingsCache()

    await sendOtpEmail({ to: 'admin@example.com', otp: '123456' })

    expect(lastFrom()).toBe(RESEND_NAME)
  })

  it('uses EMAIL_FROM when only the legacy var is set', async () => {
    process.env.EMAIL_FROM = LEGACY_NAME
    __resetSettingsCache()

    await sendOtpEmail({ to: 'admin@example.com', otp: '123456' })

    expect(lastFrom()).toBe(LEGACY_NAME)
  })

  it('falls back to the built-in placeholder when neither is set', async () => {
    __resetSettingsCache()

    await sendOtpEmail({ to: 'admin@example.com', otp: '123456' })

    expect(lastFrom()).toBe(DEFAULT_EMAIL_FROM)
  })

  it('leaves the rest of the payload alone', async () => {
    process.env.RESEND_FROM_EMAIL = RESEND_NAME
    __resetSettingsCache()

    await sendOtpEmail({ to: 'admin@example.com', otp: '123456' })

    const [payload, opts] = sendImpl.mock.calls[0]
    expect(payload.to).toEqual(['admin@example.com'])
    expect(payload.subject).toBe('Your Marcus Cleaning login code')
    expect(opts.idempotencyKey).toBe('otp/admin@example.com/123456')
  })
})
