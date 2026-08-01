import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest'

/**
 * What `dispatch()` hands the Resend SDK: the sender address, and the RENDERED
 * email body.
 *
 * Sender — `RESEND_FROM_EMAIL` first, `EMAIL_FROM` second, built-in placeholder
 * last. `RESEND_FROM_EMAIL` is the name Resend's own docs use, so it is the one
 * deployments already have set; `EMAIL_FROM` predates it here and must keep
 * working. Getting this wrong is not subtle — Resend rejects the placeholder
 * sender outright, which takes down the admin login OTP with it.
 *
 * Body — `html`/`text` strings we rendered ourselves, NEVER a `react` element.
 * Handing the SDK `react` makes it resolve a renderer through a dynamic
 * `import('@react-email/render')` that Next's file tracing cannot follow, so the
 * renderer is missing from the deployed bundle and every template send fails
 * with "Failed to render React component". That is a production outage, not a
 * style preference, which is why it is pinned here.
 *
 * The Resend client is mocked so `dispatch()` — including the real React Email
 * render — runs for real and we can assert on the exact payload handed to the SDK.
 */

/** The shape `dispatch()` hands the Resend SDK — typed so `mock.calls` is too. */
type ResendPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  /** Must never be populated again — see the header. Typed so the assertion compiles. */
  react?: unknown
}
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

describe('dispatch renders the template itself and sends html/text, never `react`', () => {
  /** A code with no repeated digits, so finding it in the output cannot be luck. */
  const OTP = '482913'

  async function otpPayload(): Promise<ResendPayload> {
    await sendOtpEmail({ to: 'admin@example.com', otp: OTP })
    expect(sendImpl).toHaveBeenCalledTimes(1)
    return sendImpl.mock.calls[0][0]
  }

  it('passes no `react` element at all', async () => {
    // The whole bug: `react` is what triggers the SDK's untraceable dynamic
    // import of the renderer.
    expect((await otpPayload()).react).toBeUndefined()
  })

  it('passes a non-empty html STRING', async () => {
    const { html } = await otpPayload()

    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })

  it('passes a non-empty text STRING', async () => {
    const { text } = await otpPayload()

    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })

  it('really rendered the OtpEmail template — the html carries the code and the copy', async () => {
    const { html } = await otpPayload()

    // Asserting only `typeof html === 'string'` would pass on `''` or on a
    // stringified object. These assertions only hold if the actual template
    // rendered, which is the thing production was failing to do.
    expect(html).toContain(OTP)
    expect(html).toContain('Your Marcus Cleaning login code')
    expect(html).toContain('admin@example.com')
    expect(html).toMatch(/<html\b/i)
  })

  it('renders the plain-text alternative from the same template, code included', async () => {
    const { text, html } = await otpPayload()

    expect(text).toContain(OTP)
    // Plain text, not a copy of the markup — otherwise it is no fallback at all.
    expect(text).not.toContain('<html')
    expect(text).not.toContain('<p ')
    expect(text.length).toBeLessThan(html.length)
  })

  it('renders the code that was actually asked for, not a cached first render', async () => {
    await sendOtpEmail({ to: 'admin@example.com', otp: '111111' })
    await sendOtpEmail({ to: 'admin@example.com', otp: '999999' })

    expect(sendImpl.mock.calls[0][0].html).toContain('111111')
    expect(sendImpl.mock.calls[1][0].html).toContain('999999')
    expect(sendImpl.mock.calls[1][0].html).not.toContain('111111')
  })
})

describe('dispatch surfaces a render failure instead of sending an empty email', () => {
  afterEach(() => {
    vi.doUnmock('@react-email/components')
    vi.resetModules()
  })

  it('throws EMAIL_SEND_FAILED and never calls Resend when the render throws', async () => {
    // A silently-empty email is worse than a hard failure: it looks delivered.
    vi.resetModules()
    vi.doMock('@react-email/components', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      render: vi.fn(async () => {
        throw new Error('Failed to render React component.')
      }),
    }))

    const { sendOtpEmail: freshSendOtpEmail } = await import('@/server/core/email/send')

    await expect(freshSendOtpEmail({ to: 'admin@example.com', otp: '123456' })).rejects.toMatchObject({
      httpStatus: 502,
      code: 'EMAIL_SEND_FAILED',
      details: {
        name: 'EMAIL_RENDER_FAILED',
        // The provider's own words survive: the health diagnostic reads exactly
        // this to tell a render failure from a delivery failure.
        message: expect.stringContaining('Failed to render React component.'),
      },
    })
    expect(sendImpl).not.toHaveBeenCalled()
  })
})
