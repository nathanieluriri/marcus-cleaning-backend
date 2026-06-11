# 08 — Email (Resend + React Email)

Decision **D8**: replace synchronous SMTP (`smtplib` in `services/email_service.py`) with **Resend** + **React Email** templates.

This also removes a serverless footgun: SMTP connections are slow to open and block the function. Resend is a single HTTPS call.

## Why this is also an architecture improvement

- The current `email_service.py` opens an SMTP connection per send (login + STARTTLS + send + quit) — expensive and fragile on short-lived serverless functions.
- Templates are Python functions returning HTML strings — hard to preview/maintain. React Email components are previewable and componentized.
- Resend gives delivery/bounce webhooks, idempotency, and suppression handling out of the box.

## Client setup

```ts
// src/server/core/email/resend.ts
import { Resend } from 'resend'
import { settings } from '../settings'
export const resend = new Resend(settings.RESEND_API_KEY)
```

- **Always server-side.** Resend's API rejects browser calls (no CORS) to protect the key — fine, all sends are in services.
- Node.js runtime (default).
- **Domain verification is mandatory** before sending to real recipients. Verify the sending domain (SPF/DKIM DNS). The `from` domain must match a verified domain exactly. The sandbox `onboarding@resend.dev` only delivers to your own Resend account email (others → 403).

## Templates (React Email)

Port each current template 1:1 to a `.tsx` component under `src/emails/`:

| Current (`email_templates/*.py`) | Target (`emails/*.tsx`) | Trigger |
|---|---|---|
| `otp_template.py` | `otp.tsx` | login OTP |
| `new_sign_in.py` | `new-sign-in.tsx` | new sign-in warning |
| `invitation_template.py` | `invitation.tsx` | admin invite |
| `revoking_template.py` | `revoke.tsx` | access revoked |
| `changing_password_template.py` | `password-reset.tsx` | password change/reset |

```tsx
// src/emails/otp.tsx
import { Html, Head, Body, Container, Text, Heading } from '@react-email/components'

export function OtpEmail({ otp, userEmail }: { otp: string; userEmail: string }) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>Your login code</Heading>
          <Text>Use {otp} to sign in as {userEmail}.</Text>
          <Text>This code expires shortly. If you didn’t request it, ignore this email.</Text>
        </Container>
      </Body>
    </Html>
  )
}
```

> Branding note: the current sender display name is "Aperture Security" / "EPS Booking Admin Portal" in some templates — confirm the correct Marcus Cleaning branding/sender during port (flagged in `15`).

## Sending

```ts
// src/server/core/email/send.ts
import { resend } from './resend'
import { OtpEmail } from '@/emails/otp'
import { settings } from '../settings'

export async function sendOtpEmail(args: { to: string; otp: string }) {
  const { data, error } = await resend.emails.send(
    {
      from: settings.EMAIL_FROM,             // e.g. "Marcus Cleaning <no-reply@mail.marcus.app>"
      to: [args.to],
      subject: 'Your login code',
      react: OtpEmail({ otp: args.otp, userEmail: args.to }), // function call, NOT <OtpEmail/>
    },
    { idempotencyKey: `otp/${args.to}/${args.otp}` },         // dedupe within 24h
  )
  if (error) throw emailSendError(error)   // SDK returns {data,error}; it does NOT throw
  return data
}
```

Critical gotchas:
- **The Node SDK never throws on API errors** — it returns `{ data, error }`. Always check `error`.
- Pass the React component as a **function call** (`OtpEmail({...})`), not JSX, in the `react` field.
- **Idempotency key** is the *second* argument. 24-hour dedupe window; ≤256 chars. Same key + same payload → returns the original result (no resend); same key + **different** payload → **409 conflict**. Use stable keys like `welcome/<userId>` or `otp/<email>/<otp>`.

## Batch send

`resend.emails.batch.send([...])` for 2–100 emails (e.g. system broadcasts). **Atomic** (one invalid address fails the whole batch); **no attachments, no `scheduled_at`** in batch mode. For broadcast fan-out beyond 100 recipients, chunk and consider the future queue option (`10`/`15`).

## Webhooks (delivery / bounce / complaint)

Add a webhook endpoint to track deliverability and auto-suppress bad addresses. Resend uses **Svix** signatures — verify against the **raw body**.

```ts
// route: POST /api/webhooks/resend  (public, signature-verified)
export async function handleResendWebhook(c: Context) {
  const payload = await c.req.text()                  // raw text — NOT .json()
  const event = resend.webhooks.verify({
    payload,
    headers: {
      'svix-id': c.req.header('svix-id'),
      'svix-timestamp': c.req.header('svix-timestamp'),
      'svix-signature': c.req.header('svix-signature'),
    },
    secret: settings.RESEND_WEBHOOK_SECRET,
  })
  // event.type: email.delivered | email.bounced | email.complained | email.delivery_delayed | email.suppressed
  // → record on the relevant user/notification record; suppress hard-bounced/complained addresses
  return c.text('OK', 200)
}
```

Add `POST /v1/webhooks/resend` (or `/api/webhooks/resend`) to the router list; register the URL + signing secret in the Resend dashboard. Hard-bounced/complained addresses are auto-suppressed by Resend (future sends emit `email.suppressed`).

## Env (see `11`)

`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`. The old `EMAIL_USERNAME/PASSWORD/HOST/PORT` are **removed**.

## Cross-references

- Where sends are triggered (auth/OTP, invites, broadcasts): `06`, `07`
- Broadcast fan-out scaling: `10`, `15`
