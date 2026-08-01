import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'

/**
 * POST /api/health/email-test — the secret-gated email diagnostic.
 *
 * This endpoint deliberately returns things `/api/health` refuses to: the real
 * sender address and the provider's RAW error text. Two invariants make that
 * safe, and both are pinned here:
 *
 *  1. The gate. No secret configured → 404 (the route must not exist by
 *     default). Wrong or missing header → the SAME 401, never a hint as to which.
 *  2. The key never travels. The leak test seeds a sentinel RESEND_API_KEY and
 *     asserts it appears nowhere in the serialized body — including when the
 *     provider error itself quotes it back at us.
 *
 * Resend and Mongo are mocked (health-env.test.ts / email-sender-address.test.ts
 * pattern) — no live provider, no DB.
 */

type ResendPayload = { from: string; to: string[]; subject: string; text?: string }
type ResendResult = {
  data: { id: string } | null
  error: { name: string; message: string; statusCode?: number } | null
}

const sendImpl = vi.fn<(payload: ResendPayload) => Promise<ResendResult>>(async () => ({
  data: { id: 'msg_diag' },
  error: null,
}))

/**
 * Set to make `getResend()` itself throw — the missing-API-key path, which
 * fails before any request is made. Read lazily inside the factory's returned
 * function: `vi.mock` is hoisted, so anything it dereferences eagerly would be
 * touched before initialization.
 */
let getResendThrows: Error | null = null

vi.mock('@/server/core/email/resend', () => ({
  getResend: vi.fn(() => {
    if (getResendThrows) throw getResendThrows
    return { emails: { send: sendImpl } }
  }),
}))

vi.mock('@/server/core/mongo', () => ({
  getDb: vi.fn(() => ({ command: vi.fn(async () => ({ ok: 1 })) })),
  getClient: vi.fn(),
}))

/**
 * The REAL OTP send helper, mocked. `mode: 'otp'` must reach THIS — template,
 * idempotency key and all — rather than the endpoint's own plain-text probe;
 * that is the entire point of the mode, so every case below asserts on which of
 * the two was called.
 *
 * The route imports it dynamically (inside its try), so this factory does not
 * run until the first otp-mode request.
 */
const sendOtpEmailImpl = vi.fn<(args: { to: string; otp: string }) => Promise<{ id: string } | null>>(async () => ({
  id: 'msg_otp',
}))

vi.mock('@/server/core/email/send', () => ({
  sendOtpEmail: sendOtpEmailImpl,
}))

import { health } from '@/server/routes/health'

const SECRET = 'diagnostics-secret-value-0123456789'
const CRON = 'cron-secret-value-0123456789'
const TO = 'someone@example.com'

/** Keys this suite owns — cleared before every test so cases can't bleed. */
const MANAGED_KEYS = ['DIAGNOSTICS_SECRET', 'CRON_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'EMAIL_FROM'] as const

const originalEnv: Record<string, string | undefined> = {}
for (const k of MANAGED_KEYS) originalEnv[k] = process.env[k]

interface EmailTestBody {
  resolvedFrom: string
  emailFromSource: string
  apiKeyPresent: boolean
  /** Present for `mode: 'otp'` only — the throwaway code that was actually sent. */
  otpUsed?: string
  send:
    | { ok: true; id: string | null }
    | { ok: false; error: { name: string; message: string; statusCode?: number; stack?: string[] } }
}

async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: string; body: Record<string, unknown> }> {
  const res = await health.request('/health/email-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const raw = await res.text()
  return { status: res.status, raw, body: JSON.parse(raw) as Record<string, unknown> }
}

/** Authorised call with the secret header already attached. */
async function authorized(body: unknown = { to: TO }) {
  const res = await post(body, { 'x-diagnostics-secret': SECRET })
  return { ...res, body: res.body as unknown as EmailTestBody }
}

/** Authorised call that exercises the real OTP send path. */
async function authorizedOtp(body: Record<string, unknown> = {}) {
  return authorized({ to: TO, mode: 'otp', ...body })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-establish the default implementations: a per-case override must not
  // survive into the next test.
  sendImpl.mockImplementation(async () => ({ data: { id: 'msg_diag' }, error: null }))
  sendOtpEmailImpl.mockImplementation(async () => ({ id: 'msg_otp' }))
  getResendThrows = null
  for (const k of MANAGED_KEYS) delete process.env[k]
})

afterAll(() => {
  for (const k of MANAGED_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(originalEnv)) if (v !== undefined) process.env[k] = v
})

describe('POST /api/health/email-test — the secret gate', () => {
  it('404s when NEITHER secret env var is set (off by default)', async () => {
    const { status, body } = await post({ to: TO }, { 'x-diagnostics-secret': SECRET })

    expect(status).toBe(404)
    expect(sendImpl).not.toHaveBeenCalled()
    // Byte-identical to the app's own not-found envelope: a probe cannot tell a
    // disabled endpoint from one that was never deployed.
    expect(body).toMatchObject({ success: false, data: { code: 'NOT_FOUND' } })
  })

  it('404s before validating the body, so a disabled route never leaks its shape', async () => {
    const { status, body } = await post({ nope: true }, { 'x-diagnostics-secret': SECRET })

    expect(status).toBe(404)
    expect(body).toMatchObject({ data: { code: 'NOT_FOUND' } })
  })

  it('401s when the header is missing', async () => {
    process.env.DIAGNOSTICS_SECRET = SECRET

    const { status, body } = await post({ to: TO })

    expect(status).toBe(401)
    expect(sendImpl).not.toHaveBeenCalled()
    expect(body).toMatchObject({ success: false, data: { code: 'UNAUTHORIZED' } })
  })

  it('401s when the header is wrong', async () => {
    process.env.DIAGNOSTICS_SECRET = SECRET

    const { status, body } = await post({ to: TO }, { 'x-diagnostics-secret': 'not-the-secret' })

    expect(status).toBe(401)
    expect(sendImpl).not.toHaveBeenCalled()
    expect(body).toMatchObject({ data: { code: 'UNAUTHORIZED' } })
  })

  it('returns the IDENTICAL response for a missing and a wrong header', async () => {
    process.env.DIAGNOSTICS_SECRET = SECRET

    const missing = await post({ to: TO })
    const wrong = await post({ to: TO }, { 'x-diagnostics-secret': 'not-the-secret' })
    // A same-length guess must not be distinguishable either.
    const sameLength = await post({ to: TO }, { 'x-diagnostics-secret': 'x'.repeat(SECRET.length) })

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(sameLength.status).toBe(401)
    expect(wrong.raw).toBe(missing.raw)
    expect(sameLength.raw).toBe(missing.raw)
  })

  it('accepts the correct secret', async () => {
    process.env.DIAGNOSTICS_SECRET = SECRET

    expect((await authorized()).status).toBe(200)
  })

  it('falls back to CRON_SECRET when DIAGNOSTICS_SECRET is unset', async () => {
    process.env.CRON_SECRET = CRON

    expect((await post({ to: TO }, { 'x-diagnostics-secret': CRON })).status).toBe(200)
    expect((await post({ to: TO }, { 'x-diagnostics-secret': SECRET })).status).toBe(401)
  })

  it('prefers DIAGNOSTICS_SECRET over CRON_SECRET when both are set', async () => {
    process.env.DIAGNOSTICS_SECRET = SECRET
    process.env.CRON_SECRET = CRON

    expect((await post({ to: TO }, { 'x-diagnostics-secret': SECRET })).status).toBe(200)
    // The cron secret must NOT also unlock the diagnostic once a dedicated one exists.
    expect((await post({ to: TO }, { 'x-diagnostics-secret': CRON })).status).toBe(401)
  })

  it('treats a blank secret env var as unset (404, not an empty-string bypass)', async () => {
    process.env.DIAGNOSTICS_SECRET = '   '

    expect((await post({ to: TO }, { 'x-diagnostics-secret': '' })).status).toBe(404)
    expect((await post({ to: TO }, { 'x-diagnostics-secret': '   ' })).status).toBe(404)
  })
})

describe('POST /api/health/email-test — request validation', () => {
  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
  })

  it('422s when `to` is missing', async () => {
    const { status, body } = await post({}, { 'x-diagnostics-secret': SECRET })

    expect(status).toBe(422)
    expect(body).toMatchObject({ data: { code: 'VALIDATION_FAILED' } })
    expect(sendImpl).not.toHaveBeenCalled()
  })

  it('422s when `to` is not an email address', async () => {
    const { status } = await post({ to: 'not-an-email' }, { 'x-diagnostics-secret': SECRET })

    expect(status).toBe(422)
    expect(sendImpl).not.toHaveBeenCalled()
  })

  it('422s on a body that is not JSON at all', async () => {
    const res = await health.request('/health/email-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-diagnostics-secret': SECRET },
      body: 'not json{',
    })

    expect(res.status).toBe(422)
  })
})

describe('POST /api/health/email-test — successful send', () => {
  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
  })

  it('reports send.ok true with the provider message id', async () => {
    sendImpl.mockImplementation(async () => ({ data: { id: 'msg_live_123' }, error: null }))

    const { status, body } = await authorized()

    expect(status).toBe(200)
    expect(body.send).toEqual({ ok: true, id: 'msg_live_123' })
  })

  it('sends to the requested address, from the resolved sender, with a plain-text body', async () => {
    process.env.RESEND_FROM_EMAIL = 'Marcus Cleaning <no-reply@verified.example.com>'

    await authorized({ to: 'ops@example.org' })

    expect(sendImpl).toHaveBeenCalledTimes(1)
    const payload = sendImpl.mock.calls[0][0]
    expect(payload.to).toEqual(['ops@example.org'])
    expect(payload.from).toBe('Marcus Cleaning <no-reply@verified.example.com>')
    expect(payload.subject).toBe('Cleanm email diagnostic')
    expect(typeof payload.text).toBe('string')
  })

  it('reports the resolved sender and which var supplied it', async () => {
    process.env.RESEND_FROM_EMAIL = 'Marcus Cleaning <no-reply@verified.example.com>'
    process.env.EMAIL_FROM = 'Marcus Cleaning <legacy@example.com>'

    const { body } = await authorized()

    // The gate is what makes returning the literal address safe — this is the
    // string the caller needs to compare against their verified Resend domain.
    expect(body.resolvedFrom).toBe('Marcus Cleaning <no-reply@verified.example.com>')
    expect(body.emailFromSource).toBe('RESEND_FROM_EMAIL')
  })

  it('reports EMAIL_FROM as the source when only the legacy var is set', async () => {
    process.env.EMAIL_FROM = 'Marcus Cleaning <legacy@example.com>'

    const { body } = await authorized()

    expect(body.resolvedFrom).toBe('Marcus Cleaning <legacy@example.com>')
    expect(body.emailFromSource).toBe('EMAIL_FROM')
  })

  it('reports the built-in placeholder as source "default" when neither var is set', async () => {
    const { body } = await authorized()

    expect(body.emailFromSource).toBe('default')
  })

  it('reports apiKeyPresent from the env, and never the key itself', async () => {
    expect((await authorized()).body.apiKeyPresent).toBe(false)

    process.env.RESEND_API_KEY = 're_present_key'
    expect((await authorized()).body.apiKeyPresent).toBe(true)

    process.env.RESEND_API_KEY = '   '
    expect((await authorized()).body.apiKeyPresent).toBe(false)
  })
})

describe('POST /api/health/email-test — provider failure is reported, never thrown', () => {
  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
  })

  it('returns 200 with send.ok false and the RAW provider message', async () => {
    sendImpl.mockImplementation(async () => ({
      data: null,
      error: {
        name: 'validation_error',
        message: 'The example.com domain is not verified. Please verify your domain on resend.com/domains',
        statusCode: 403,
      },
    }))

    const { status, body } = await authorized()

    // 200, not 502: the failure IS the payload. A 5xx would put the detail back
    // in the runtime log this endpoint exists to bypass.
    expect(status).toBe(200)
    expect(body.send.ok).toBe(false)
    expect(body.send).toEqual({
      ok: false,
      error: {
        name: 'validation_error',
        message: 'The example.com domain is not verified. Please verify your domain on resend.com/domains',
        statusCode: 403,
      },
    })
  })

  it('omits statusCode when the provider did not supply one', async () => {
    sendImpl.mockImplementation(async () => ({
      data: null,
      error: { name: 'application_error', message: 'Something went wrong' },
    }))

    const { body } = await authorized()

    expect(body.send).toEqual({ ok: false, error: { name: 'application_error', message: 'Something went wrong' } })
  })

  it('catches the raw Error thrown when the API key is missing', async () => {
    // getResend() throws BEFORE any request is made — the single most likely
    // cause of OTP_EMAIL_FAILED, and the one a naive try-less handler 500s on.
    getResendThrows = new Error('RESEND_API_KEY is not configured; cannot send email')

    const { status, body } = await authorized()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({
      ok: false,
      error: { name: 'Error', message: 'RESEND_API_KEY is not configured; cannot send email' },
    })
    expect(body.apiKeyPresent).toBe(false)
  })

  it('catches a rejected send (network/transport failure)', async () => {
    sendImpl.mockImplementation(async () => {
      throw new TypeError('fetch failed')
    })

    const { status, body } = await authorized()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({ ok: false, error: { name: 'TypeError', message: 'fetch failed' } })
  })

  it('survives a non-Error throw without becoming a 500', async () => {
    sendImpl.mockImplementation(async () => {
      throw 'plain string failure'
    })

    const { status, body } = await authorized()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({ ok: false, error: { name: 'Error', message: 'plain string failure' } })
  })
})

describe("POST /api/health/email-test — mode: 'otp' runs the real login send path", () => {
  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
  })

  it('calls sendOtpEmail and reports its message id', async () => {
    sendOtpEmailImpl.mockImplementation(async () => ({ id: 'msg_otp_live' }))

    const { status, body } = await authorizedOtp()

    expect(status).toBe(200)
    expect(sendOtpEmailImpl).toHaveBeenCalledTimes(1)
    // The plain-text probe must NOT also fire — a mode that quietly falls back
    // to it would keep reporting the success we already know about.
    expect(sendImpl).not.toHaveBeenCalled()
    expect(body.send).toEqual({ ok: true, id: 'msg_otp_live' })
  })

  it('sends to the requested address with a 6-digit code, echoed as otpUsed', async () => {
    const { body } = await authorizedOtp({ to: 'ops@example.org' })

    const args = sendOtpEmailImpl.mock.calls[0][0]
    expect(args.to).toBe('ops@example.org')
    expect(args.otp).toMatch(/^\d{6}$/)
    // `otpUsed` has to be the code actually sent, or it cannot be used to read
    // the delivered email — or to reason about the idempotency key.
    expect(body.otpUsed).toBe(args.otp)
  })

  it('uses a fresh code per call, so Resend cannot dedupe repeat probes', async () => {
    // sendOtpEmail keys idempotency on `otp/<to>/<code>` with a 24h dedupe
    // window: a fixed code would make every call after the first replay the
    // first result instead of really sending.
    const codes = new Set<string>()
    for (let i = 0; i < 5; i++) codes.add((await authorizedOtp()).body.otpUsed ?? '')

    expect(codes.size).toBeGreaterThan(1)
  })

  it('reports null when the provider returned no message id', async () => {
    sendOtpEmailImpl.mockImplementation(async () => null)

    expect((await authorizedOtp()).body.send).toEqual({ ok: true, id: null })
  })

  it('still reports the resolved sender and api-key presence', async () => {
    process.env.RESEND_FROM_EMAIL = 'Marcus Cleaning <no-reply@verified.example.com>'
    process.env.RESEND_API_KEY = 're_present_key'

    const { body } = await authorizedOtp()

    expect(body.resolvedFrom).toBe('Marcus Cleaning <no-reply@verified.example.com>')
    expect(body.emailFromSource).toBe('RESEND_FROM_EMAIL')
    expect(body.apiKeyPresent).toBe(true)
  })

  it('defaults to the plain-text path when `mode` is omitted', async () => {
    const { status, body } = await authorized()

    expect(status).toBe(200)
    expect(sendImpl).toHaveBeenCalledTimes(1)
    expect(sendOtpEmailImpl).not.toHaveBeenCalled()
    expect(typeof sendImpl.mock.calls[0][0].text).toBe('string')
    // No throwaway code was generated, so none is reported.
    expect(body.otpUsed).toBeUndefined()
  })

  it("takes the plain-text path for an explicit mode: 'text'", async () => {
    await authorized({ to: TO, mode: 'text' })

    expect(sendImpl).toHaveBeenCalledTimes(1)
    expect(sendOtpEmailImpl).not.toHaveBeenCalled()
  })

  it('422s on an unknown mode rather than silently defaulting', async () => {
    const { status, body } = await post({ to: TO, mode: 'html' }, { 'x-diagnostics-secret': SECRET })

    expect(status).toBe(422)
    expect(body).toMatchObject({ data: { code: 'VALIDATION_FAILED' } })
    expect(sendOtpEmailImpl).not.toHaveBeenCalled()
    expect(sendImpl).not.toHaveBeenCalled()
  })
})

describe("POST /api/health/email-test — mode: 'otp' failures are reported, never thrown", () => {
  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
  })

  it('returns 200 with send.ok false when sendOtpEmail throws', async () => {
    // The prime suspect: the React Email template failing to render inside the
    // deployed bundle. It must arrive as a body, not as a 500 whose detail lands
    // only in the runtime log this endpoint exists to bypass.
    sendOtpEmailImpl.mockImplementation(async () => {
      throw new TypeError('jsx is not a function')
    })

    const { status, body } = await authorizedOtp()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({ ok: false, error: { name: 'TypeError', message: 'jsx is not a function' } })
  })

  it('includes the top stack frames, which a render failure needs to be readable', async () => {
    sendOtpEmailImpl.mockImplementation(async () => {
      throw new Error('Cannot read properties of undefined')
    })

    const { body } = await authorizedOtp()

    expect(body.send.ok).toBe(false)
    if (body.send.ok) throw new Error('unreachable')
    const stack = body.send.error.stack
    expect(Array.isArray(stack)).toBe(true)
    expect(stack?.length).toBeGreaterThan(1)
    expect(stack?.length).toBeLessThanOrEqual(5)
    expect(stack?.[0]).toContain('Cannot read properties of undefined')
  })

  it('unwraps the provider detail out of the AppError sendOtpEmail wraps it in', async () => {
    // sendOtpEmail turns a Resend rejection into AppError('Failed to send
    // email', details: <provider error>). Reporting only the wrapper would hand
    // back our own generic sentence — precisely the loss this endpoint exists to
    // prevent.
    sendOtpEmailImpl.mockImplementation(async () => {
      throw Object.assign(new Error('Failed to send email'), {
        name: 'AppError',
        details: { name: 'validation_error', message: 'The from address is not verified', statusCode: 403 },
      })
    })

    const { status, body } = await authorizedOtp()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({
      ok: false,
      error: {
        name: 'validation_error',
        message: 'Failed to send email: The from address is not verified',
        statusCode: 403,
      },
    })
  })

  it('survives a non-Error throw without becoming a 500', async () => {
    sendOtpEmailImpl.mockImplementation(async () => {
      throw 'plain string failure'
    })

    const { status, body } = await authorizedOtp()

    expect(status).toBe(200)
    expect(body.send).toMatchObject({ ok: false, error: { name: 'Error', message: 'plain string failure' } })
  })

  it('leaves the plain-text mode stack-free', async () => {
    sendImpl.mockImplementation(async () => {
      throw new Error('fetch failed')
    })

    const { body } = await authorized()

    expect(body.send.ok).toBe(false)
    if (body.send.ok) throw new Error('unreachable')
    expect(body.send.error.stack).toBeUndefined()
  })
})

describe('POST /api/health/email-test — never leaks the API key', () => {
  const SENTINEL_KEY = 're_SENTINEL_APIKEY_do_not_leak_0123456789'

  beforeEach(() => {
    process.env.DIAGNOSTICS_SECRET = SECRET
    process.env.RESEND_API_KEY = SENTINEL_KEY
    process.env.RESEND_FROM_EMAIL = 'Marcus Cleaning <no-reply@verified.example.com>'
  })

  it('contains no fragment of the seeded key on a successful send', async () => {
    const { raw, body } = await authorized()

    expect(body.apiKeyPresent).toBe(true)
    expect(raw).not.toContain(SENTINEL_KEY)
    for (const fragment of ['SENTINEL', 're_', '0123456789']) {
      expect(raw, `fragment "${fragment}" leaked into the response`).not.toContain(fragment)
    }
  })

  it('contains no fragment of the seeded key when the provider errors', async () => {
    sendImpl.mockImplementation(async () => ({
      data: null,
      error: { name: 'validation_error', message: 'API key is invalid', statusCode: 401 },
    }))

    const { raw } = await authorized()

    expect(raw).not.toContain(SENTINEL_KEY)
    expect(raw).not.toContain('SENTINEL')
  })

  it('scrubs the key even when the provider quotes it back verbatim', async () => {
    // Resend does not do this today, but the endpoint hands back RAW provider
    // text — the redaction must hold regardless of what the provider says.
    sendImpl.mockImplementation(async () => ({
      data: null,
      error: { name: 'validation_error', message: `API key ${SENTINEL_KEY} is invalid`, statusCode: 401 },
    }))

    const { raw, body } = await authorized()

    expect(raw).not.toContain(SENTINEL_KEY)
    expect(raw).not.toContain('SENTINEL')
    expect(body.send).toMatchObject({ ok: false, error: { message: 'API key [redacted] is invalid' } })
  })

  it('never leaks the diagnostics secret either', async () => {
    const { raw } = await authorized()

    expect(raw).not.toContain(SECRET)
  })

  it("contains no fragment of the seeded key in mode: 'otp'", async () => {
    const { raw, body } = await authorizedOtp()

    expect(body.apiKeyPresent).toBe(true)
    expect(raw).not.toContain(SENTINEL_KEY)
    for (const fragment of ['SENTINEL', 're_', '0123456789']) {
      expect(raw, `fragment "${fragment}" leaked into the response`).not.toContain(fragment)
    }
  })

  it('scrubs the key out of the OTP-mode stack, not just the message', async () => {
    // The stack is returned verbatim apart from redaction, and its first line is
    // the message — so the scrub has to reach every line, not only `message`.
    sendOtpEmailImpl.mockImplementation(async () => {
      throw new Error(`render failed while using ${SENTINEL_KEY}`)
    })

    const { raw, body } = await authorizedOtp()

    expect(raw).not.toContain(SENTINEL_KEY)
    expect(raw).not.toContain('SENTINEL')
    expect(body.send).toMatchObject({ ok: false, error: { message: 'render failed while using [redacted]' } })
    if (body.send.ok) throw new Error('unreachable')
    expect(body.send.error.stack?.[0]).toContain('[redacted]')
  })
})
