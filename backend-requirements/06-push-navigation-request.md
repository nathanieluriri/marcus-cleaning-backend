# 06 — Push notifications: what we need from the frontend

**To:** frontend team
**Why:** push delivery is built and live, but three things can only be decided on your side —
**where each notification navigates**, **how the deep link is expressed**, and **the sound**.
Give us the tables below filled in and we'll wire the rest.

Two of these are not backend choices at all, and it's worth saying why up front:

- **On Android 8+, the notification sound is set by the APP when it creates the channel — not
  by anything the server sends.** The backend can only name a `channelId`. If the app doesn't
  create a channel with the sweeping sound attached, the sound will not play, no matter what
  we send. So the sound work is mostly yours.
- **Deep links are app routes.** We don't know your navigator's paths, and guessing would
  produce links that silently no-op.

---

## 1. Deep-link mechanism — pick one

| Option | What we'd send | Notes |
|---|---|---|
| **A. Custom scheme** (recommended) | `marcuscleaning://booking/665f...` | Simplest. Works cold-start. No domain setup. Can't be opened from a browser. |
| **B. Universal / App Links** | `https://app.marcuscleaning.com/booking/665f...` | Opens from email and web too. Needs `apple-app-site-association` + `assetlinks.json` hosted on the domain, and a domain we control. |
| **C. Structured only** | `{ "type": "booking.started", "entityType": "booking", "entityId": "665f..." }` | No URL at all — your notification handler switches on `type` and calls the navigator itself. Most flexible, no link parsing. |

**Tell us: A, B or C, and the scheme/domain if A or B.**

We will send **all three shapes regardless** — `type`, `entityType`/`entityId`, and a `route`
string — so you can change your mind without a backend deploy. Pick which one you'll actually
key off so we can prioritise getting it right.

---

## 2. Route table — the main ask

Every notification we can currently emit is listed. **Fill in the "App route" column.**
Leave a row blank if it should just open the app with no navigation.

### Customer app

| `type` | When it fires | Payload IDs we send | App route |
|---|---|---|---|
| `booking.created` | Customer books a specific cleaner | `bookingId` | |
| `booking.cancelled` | Either party cancels | `bookingId` | |
| `booking.rescheduled` | Either party moves the time | `bookingId` | |
| `job.en_route` | Cleaner taps "on my way" | `bookingId`, `etaAt` | |
| `job.started` | Cleaner starts the job | `bookingId` | |
| `job.completed` | Cleaner finishes | `bookingId` | |
| `chat.message` | Cleaner sends a message | `conversationId`, `bookingId`, `sequence` | |
| `support.ticket_created` | Their ticket is logged | `ticketId`, `reference` | |
| `promo.broadcast` | Admin promo blast (new — see §4) | `promoId`, `promoCode` | |

### Staff app

| `type` | When it fires | Payload IDs we send | App route |
|---|---|---|---|
| `booking.created` | New job offered to them | `bookingId` | |
| `booking.cancelled` | Customer cancels their job | `bookingId` | |
| `booking.rescheduled` | Job time moved | `bookingId` | |
| `application.submitted` | We received their application | `applicationId` | |
| `application.under_review` | Review started | `applicationId` | |
| `application.more_info_required` | We need more from them | `applicationId` | |
| `application.approved` | Approved | `applicationId` | |
| `application.rejected` | Not approved | `applicationId` | |
| `payout.requested` | Cash-out accepted and processing | `payoutId`, `amount` | |
| `payout.paid` | Money actually sent (new) | `payoutId`, `amount` | |
| `payout.failed` | Payout failed (new) | `payoutId`, `failureReason` | |
| `sos.raised` | Their SOS was received | `alertId`, `bookingId` | |
| `chat.message` | Customer sends a message | `conversationId`, `bookingId`, `sequence` | |
| `support.ticket_created` | Their ticket is logged | `ticketId`, `reference` | |

You mentioned cash-out specifically — that's `payout.requested` / `payout.paid` /
`payout.failed`. The last two don't exist yet; we'll add them with the real payout settlement.
Tell us if they should land on the earnings screen, a payout detail screen, or both.

**Format:** give routes with a placeholder for the id, e.g. `/bookings/:id`,
`/chat/:conversationId`, `/earnings/payouts/:id`. We'll substitute.

---

## 3. Sound — mostly your side

You asked for a sweeping/mopping sound. Here's the split.

### What you need to do

**Prepare two assets** (one is fine if you'd rather have a single sound):

| Platform | Format | Location | Limits |
|---|---|---|---|
| iOS | `.caf`, `.aiff` or `.wav` | app bundle root | **≤ 30 seconds**, must be bundled at build time |
| Android | `.mp3` or `.ogg` | `res/raw/` | referenced when the channel is created |

Suggested filenames so both platforms and the backend agree — **confirm or change these**:

```
sweeping.caf   /  res/raw/sweeping.mp3     — default for job & booking events
mopping.caf    /  res/raw/mopping.mp3      — optional second sound, if you want promos distinct
```

A short sweep — roughly **1–2 seconds**, clean, no long tail — will read as a notification
rather than a sound effect. Anything longer gets truncated or feels sluggish.

**Create the Android channels at app start.** This is the part that actually makes the sound
play on Android 8+. We'll send a `channelId`; you must have already created a channel with
that exact id and the sound attached. Proposed channels — **confirm or rename**:

| `channelId` | Purpose | Sound | Importance |
|---|---|---|---|
| `jobs` | booking + job lifecycle | sweeping | HIGH |
| `chat` | messages | default or sweeping | HIGH |
| `payouts` | cash-out and earnings | sweeping | DEFAULT |
| `promos` | marketing blasts | mopping or silent | LOW |
| `safety` | SOS | **system default alarm-ish** | MAX |

One important caveat: **a channel's sound is immutable once created.** If you ship a channel
and later change its sound, existing installs keep the old one — you have to create a *new*
channel id. So it's worth settling the sound before release. Suggest versioning if unsure:
`jobs_v1`.

Keep `safety` loud and distinct — an SOS confirmation should not sound like a promo.

### What we'll do

Send `channelId` (Android) and `sound` (iOS filename) on every push, per the table above,
plus the APNs badge count (already implemented).

---

## 4. Admin broadcasts — confirm the targeting we're building

Admin will be able to send a notification to a segment. **This part isn't blocked on you** —
we can build it now — but confirm the audience options are the ones you want surfaced:

- **Everyone**
- **All customers** / **all cleaners**
- **Specific users** (explicit id list)
- **Customers with no booking in N days** (win-back)
- **Customers who have booked at least once** (vs never)
- **Cleaners by onboarding status** (e.g. approved only)
- **Cleaners by service area / radius** — *only if you need it; it's the most work*

Each broadcast carries an optional promo code and its own deep link, so a promo push can open
straight to the offer. Admin gets a **dry-run recipient count** before sending, and we'll
record per-recipient delivery so a blast can be audited.

**Question for you:** should a broadcast also create an in-app notification row (so it appears
in the notifications tab and counts toward the badge), or be push-only and transient? Our
default would be: **yes, create a row** — a promo the user swipes away is otherwise gone
forever.

---

## 5. What's already live, so you can start now

- `POST /api/v1/devices` — register the FCM token (`token`, `platform`, `deviceId?`,
  `appVersion?`, `locale?`). Upsert on token; safe to call on every launch and token refresh.
- `DELETE /api/v1/devices/{id}` — call on logout, or the device keeps receiving the previous
  user's pushes.
- `GET /api/v1/notifications` — the in-app list. Serves both apps; each role sees its own feed.
- `GET /api/v1/notifications/unread-count` — `{ unread }` for the tab badge.
- `POST /api/v1/notifications/read-all` and `/{id}/read`.

Push delivery itself is wired to **FCM HTTP v1** (iOS via FCM's APNs bridge). The Firebase
project is created — `marcus-cleaning` — and Google/Apple sign-in plus the service-account
credentials are being configured.

Payload shape you'll receive today (the `route` / `channelId` / `sound` fields are what §1–§3
above will populate):

```json
{
  "notification": { "title": "Your cleaner is on the way", "body": "..." },
  "data": {
    "type": "job.en_route",
    "notificationId": "665f...",
    "bookingId": "665f...",
    "etaAt": "1750000000"
  }
}
```

Note **all `data` values are strings** — that's an FCM constraint, not our choice. Parse
numbers and booleans on your side.

---

## 6. Summary — what we need back

1. Deep-link mechanism: **A, B or C** (+ scheme/domain)
2. The **route table** in §2, filled in
3. **Confirm or rename** the channel ids and sound filenames in §3, and prepare the audio
4. Confirm the broadcast audiences in §4, and whether broadcasts create in-app rows

Items 1, 2 and 4 unblock everything. Item 3's audio can follow later — we'll send the
`channelId`/`sound` fields regardless, so the sound starts working the moment you ship the
channels and assets.
