import { SignJWT, importPKCS8 } from 'jose'
import { getSettings } from '../settings'

/**
 * Firebase Cloud Messaging (HTTP v1) transport. iOS devices are reached through
 * FCM's APNs bridge, so this is the only push transport the backend needs.
 *
 * Auth is a service-account JWT exchanged for a short-lived OAuth access token,
 * cached at module scope for the token's lifetime (serverless warm reuse).
 *
 * When FCM env vars are absent this module reports itself unconfigured and the
 * caller skips delivery — notifications are still persisted and readable via
 * `GET /v1/notifications`, so the app degrades to pull-only rather than failing.
 *
 * See: docs/migration/10-background-and-cron.md
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

interface CachedToken {
  token: string
  /** Epoch seconds at which the cached token should be considered stale. */
  expiresAt: number
}

const g = global as typeof globalThis & { _fcmToken?: CachedToken }

export function isConfigured(): boolean {
  const s = getSettings()
  return Boolean(s.FCM_PROJECT_ID && s.FCM_CLIENT_EMAIL && s.FCM_PRIVATE_KEY)
}

/** Env vars carry PEM newlines escaped; restore them before importing the key. */
function normalizeKey(pem: string): string {
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (g._fcmToken && g._fcmToken.expiresAt > now + 30) return g._fcmToken.token

  const { FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY } = getSettings()
  const key = await importPKCS8(normalizeKey(FCM_PRIVATE_KEY!), 'RS256')
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(FCM_CLIENT_EMAIL!)
    .setSubject(FCM_CLIENT_EMAIL!)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`)

  const json = (await res.json()) as { access_token: string; expires_in: number }
  g._fcmToken = { token: json.access_token, expiresAt: now + json.expires_in }
  return json.access_token
}

export interface PushMessage {
  token: string
  title: string
  body: string
  /** FCM data payloads are string-only; values are stringified by the caller. */
  data?: Record<string, string>
  /** Drives the app's notification-tab badge. */
  badge?: number
  /**
   * Android channel id. The channel must already exist in the app — Android 8+
   * takes the sound from the channel, not from this message.
   */
  channelId?: string
  /** iOS sound filename bundled in the app, or `default`. */
  sound?: string
  /**
   * Collapses repeat notifications about the same thing into one tray entry
   * (FCM collapse_key / APNs apns-collapse-id / Android tag). Twenty chat
   * messages should be one entry, not twenty.
   */
  collapseKey?: string
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; retryable: boolean; tokenInvalid: boolean; error: string }

/** Send one message. Never throws — the caller fans out and tolerates failures. */
export async function send(msg: PushMessage): Promise<SendOutcome> {
  const { FCM_PROJECT_ID } = getSettings()
  try {
    const token = await accessToken()
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: msg.token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
            apns: {
              // apns-collapse-id replaces the previous notification for the same
              // key instead of stacking a new one.
              ...(msg.collapseKey ? { headers: { 'apns-collapse-id': msg.collapseKey } } : {}),
              payload: { aps: { sound: msg.sound ?? 'default', badge: msg.badge ?? 0 } },
            },
            android: {
              priority: 'HIGH',
              // collapse_key drops undelivered duplicates in transit; `tag`
              // replaces the visible tray entry. Both are needed.
              ...(msg.collapseKey ? { collapse_key: msg.collapseKey } : {}),
              notification: {
                // `sound` is honoured pre-Android 8 only; from 8+ the channel
                // owns it, which is why channel_id is the meaningful field.
                sound: msg.sound && msg.sound !== 'default' ? msg.sound.replace(/\.[^.]+$/, '') : 'default',
                channel_id: msg.channelId,
                ...(msg.collapseKey ? { tag: msg.collapseKey } : {}),
              },
            },
          },
        }),
      },
    )
    if (res.ok) return { ok: true }

    const text = await res.text()
    // 404 UNREGISTERED / 400 INVALID_ARGUMENT on the token mean: stop sending here.
    const tokenInvalid = res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')
    return {
      ok: false,
      retryable: res.status >= 500 || res.status === 429,
      tokenInvalid,
      error: `${res.status} ${text}`,
    }
  } catch (err) {
    return {
      ok: false,
      retryable: true,
      tokenInvalid: false,
      error: err instanceof Error ? err.message : 'push failed',
    }
  }
}
