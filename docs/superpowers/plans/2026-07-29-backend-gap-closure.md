# Backend Gap-Closure (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six backend gaps blocking the Flutter apps' data wiring: booking hours, customer sessions, favorites, cleaner settings, notification routing fixes, payments config.

**Architecture:** Additive changes only, following the repo's strict layering (routes → services → repositories → schemas). Each change is independent; tasks 1–6 can go in any order but are planned smallest-risk-first.

**Tech Stack:** Hono + @hono/zod-openapi (zod v4), MongoDB driver, Vitest with hoisted `vi.mock` repo factories (no real Mongo in tests).

## Global Constraints

- All work in `app/` on a new branch `feature/backend-gap-closure` off current `master`.
- Envelope: success `ok(c, message, data)`; errors via `AppError(status, code, message, details)`; error code lives at `data.code`.
- OpenAPI routes use `createRoute({...})` + `router.openapi(...)`; guards applied via `router.use(path, guard)` BEFORE the route. Path params use `{param}` style.
- Tests: `vi.mock('@/server/repositories/...', () => ({...}))` factories declared before importing the module under test; module-scope Map stores; `beforeEach` clears. Run with `npm test` from `app/`; `npm run typecheck` must stay clean.
- Route-ordering: literal paths must be registered before `/{param}` catch-alls on the same router.
- Never return `*_SECRET_KEY` values from any endpoint.
- Commit per task; repo rule: NO Claude/Anthropic co-author trailers (see app/CLAUDE.md).
- Backward compatibility: no existing request/response field changes or removals; only additions.

---

### Task 1: Customer session routes

**Files:**
- Modify: `app/server/routes/customers.ts`
- Test: `app/tests/customer-sessions.test.ts` (new)

**Interfaces:**
- Produces: `POST /api/v1/customers/sessions/logout|revoke-others|revoke-all` (bearer customer). Uses existing `registerSessionRoutes(router, guard, tag)` from `./_session-routes` — tag MUST be `'Customers'` (unique OpenAPI component name).

- [ ] **Step 1: Failing test** — `app/tests/customer-sessions.test.ts`: mock `@/server/services/auth-session-service` (`logoutSession`, `revokeOtherSessions`, `revokeAllSessions` as `vi.fn`), build the app via the same pattern other route tests use — if no route-level test exists, test at the unit seam instead: import `customers` router and assert the three routes are registered by checking `customers.routes` (Hono exposes `.routes` with `path`/`method`). Simplest robust test:

```ts
import { describe, expect, it } from 'vitest'
import { customers } from '@/server/routes/customers'

describe('customer session routes', () => {
  it.each(['/sessions/logout', '/sessions/revoke-others', '/sessions/revoke-all'])(
    'registers POST %s', (path) => {
      const found = customers.routes.some((r) => r.method === 'POST' && r.path === path)
      expect(found).toBe(true)
    })
})
```

(Set the same `process.env` defaults in a `beforeEach`/top-of-file as `notification-routing.test.ts` does, since importing routes pulls settings.)

- [ ] **Step 2: Run** `npm test -- customer-sessions` → FAIL.

- [ ] **Step 3: Implement** — in `customers.ts` add imports `import { requireCustomer } from '@/server/security/guards'` and `import { registerSessionRoutes } from './_session-routes'`; at file end: `registerSessionRoutes(customers, requireCustomer(), 'Customers')`.

- [ ] **Step 4: Run** `npm test` + `npm run typecheck` → PASS/clean.

- [ ] **Step 5: Commit** `feat(auth): session logout/revoke routes for customers`

---

### Task 2: Notification routing fixes (sounds, chat cleanerRoute, missingStep)

**Files:**
- Modify: `app/server/services/notification-routing.ts`
- Test: extend `app/tests/notification-routing.test.ts`

**Interfaces:**
- Produces: `NotificationSound.NOTIFICATION = 'notification.caf'`; every entry that used `SWEEPING`/`MOPPING` now uses `NOTIFICATION`; `DEFAULT` entries unchanged. `chat.message.cleanerRoute = '/chat/:conversationId'`. `application.more_info_required` documented data keys include `missingStep` (free-form data already flows through `navigationFor`; verify `data.missingStep` survives into the push payload — `notification-dispatch.ts` passes `msg.data` through; if `navigationFor` output replaces data, ensure dispatch merges `{...msg.data, ...nav}` so `missingStep` reaches the client).

- [ ] **Step 1: Failing tests** — extend the `routingFor` describe:

```ts
it('uses the single bundled sound file for all custom-sound types', () => {
  for (const type of knownNotificationTypes()) {
    const entry = routingFor(type)
    expect(['notification.caf', 'default']).toContain(entry.sound)
  }
})

it('routes chat.message for cleaners now that the staff chat screen exists', () => {
  const nav = navigationFor('chat.message', { conversationId: 'c1' }, 'cleaner')
  expect(nav.route).toBe('/chat/c1')
})
```

And in the dispatch-facing describe (or a new one), assert `navigationFor('application.more_info_required', { applicationId: 'a1', missingStep: 'documents' }, 'cleaner')` produces a route AND that the routing entry's documented behavior keeps `missingStep` reachable (assert on whatever seam carries data — if `navigationFor` returns only nav fields, add the test at `notification-dispatch` level with mocked fcm asserting the sent data map contains `missingStep`).

- [ ] **Step 2: Run** → FAIL (sweeping.caf present).

- [ ] **Step 3: Implement** — replace the sound table:

```ts
export const NotificationSound = {
  NOTIFICATION: 'notification.caf',
  DEFAULT: 'default',
} as const
```

Update every `SWEEPING`/`MOPPING` reference to `NOTIFICATION` (grep the file). Set `chat.message.cleanerRoute: '/chat/:conversationId'`. For `missingStep`: check `notification-dispatch.ts:83-101` — it builds the FCM data from `msg.data` + nav; if `missingStep` is dropped anywhere, fix the merge so arbitrary `msg.data` keys are preserved.

- [ ] **Step 4: Run** full suite + typecheck → PASS. Note: the existing test asserting `promo.broadcast` is the only marketing type must still pass; a test may reference `SWEEPING` — update those assertions to the new constant.

- [ ] **Step 5: Commit** `fix(push): single notification.caf sound, staff chat route, missingStep passthrough`

---

### Task 3: Payments config endpoint

**Files:**
- Modify: `app/server/core/settings.ts` (add optional `STRIPE_PUBLISHABLE_KEY`), `app/server/routes/payments.ts`, `app/server/schemas/payment.ts`
- Test: `app/tests/payments-config.test.ts` (new)

**Interfaces:**
- Produces: public (unguarded) `GET /api/v1/payments/config` → data `{ defaultProvider: 'test'|'stripe'|'flutterwave', providers: string[], publishableKey: string|null }`. `providers` = providers with credentials configured (always includes `defaultProvider`; include `'test'` always; `'stripe'` when `STRIPE_SECRET_KEY` set; `'flutterwave'` when `FLUTTERWAVE_SECRET_KEY` set). `publishableKey` = `STRIPE_PUBLISHABLE_KEY ?? null`.

- [ ] **Step 1: Failing test:**

```ts
import { describe, expect, it, beforeEach } from 'vitest'

beforeEach(() => {
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017'
  process.env.DB_NAME ??= 'test'
  process.env.JWT_SECRET ??= 'x'.repeat(32)
})

describe('GET /payments/config', () => {
  it('exposes provider list and publishable key, never secrets', async () => {
    const { payments } = await import('@/server/routes/payments')
    const res = await payments.request('/config')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.defaultProvider).toBeDefined()
    expect(body.data.providers).toContain('test')
    expect(JSON.stringify(body)).not.toMatch(/sk_|SECRET/i)
    expect(body.data).toHaveProperty('publishableKey')
  })
})
```

(Adjust env bootstrapping to match `notification-routing.test.ts`, including `__resetSettingsCache()` if needed.)

- [ ] **Step 2: Run** → FAIL (404).

- [ ] **Step 3: Implement** — settings.ts: `STRIPE_PUBLISHABLE_KEY: z.string().optional()` in `EnvSchema` (no superRefine clause — it's optional metadata). schemas/payment.ts:

```ts
export const PaymentConfigOut = z.object({
  defaultProvider: z.enum(['stripe', 'flutterwave', 'test']),
  providers: z.array(z.string()),
  publishableKey: z.string().nullable(),
}).openapi('PaymentConfigOut')
```

payments.ts — register BEFORE the `/{payment_id}` route (put it right after the webhook handler, before `/` guard registrations; verify ordering against `/reference/{reference}` and `/{payment_id}`), no guard:

```ts
payments.openapi(
  createRoute({ method: 'get', path: '/config', tags: ['Payments'], responses: {
    200: { description: 'Payment provider configuration', content: {
      'application/json': { schema: envelopeOf(PaymentConfigOut) } } } } }),
  async (c) => {
    const s = getSettings()
    const providers = ['test']
    if (s.STRIPE_SECRET_KEY) providers.push('stripe')
    if (s.FLUTTERWAVE_SECRET_KEY) providers.push('flutterwave')
    return c.json(ok(c, 'Payment config retrieved successfully', {
      defaultProvider: s.PAYMENT_DEFAULT_PROVIDER,
      providers,
      publishableKey: s.STRIPE_PUBLISHABLE_KEY ?? null,
    }), 200)
  })
```

- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(payments): public provider config endpoint`

---

### Task 4: Favorites

**Files:**
- Modify: `app/server/repositories/customer-extras-repo.ts`, `app/server/services/cleaner-directory-service.ts` (export `cardFor`), `app/server/routes/customer-extras.ts`, `app/server/schemas/customer.ts` (add `favoriteCleanerIds?: string[]` to `CustomerDoc`)
- Create: `app/server/services/favorites-service.ts`
- Test: `app/tests/favorites.test.ts` (new)

**Interfaces:**
- Produces: `GET /api/v1/customers/me/favorites` → `CleanerCardOut[]`; `PUT /api/v1/customers/me/favorites/{cleaner_id}` → `{favorited: true}` (404 `NOT_FOUND` if cleaner id unknown); `DELETE /api/v1/customers/me/favorites/{cleaner_id}` → `{favorited: false}`. Both idempotent.
- Service: `favoritesService.list(customerId): Promise<CleanerCardOut[]>`, `.add(customerId, cleanerId): Promise<void>` (throws AppError 404 when cleaner missing), `.remove(customerId, cleanerId): Promise<void>`.

- [ ] **Step 1: Failing tests** — `tests/favorites.test.ts` with mocked `customer-extras-repo` (in-memory Map of `customerId → Set<string>` behind `getFavoriteCleanerIds`, `addFavorite`, `removeFavorite`), mocked `cleaner-repo.findById` (known id → doc, else null), mocked `cleaner-directory-service.cardFor` (id → `{id, name: 'X', ...}` or null). Cases: add then list returns hydrated card; add unknown cleaner throws 404; add twice → list has one; remove is idempotent; list skips cleaners whose card resolves null (deleted cleaner).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** —
  - `customer-extras-repo.ts` (matches its `$set`-style; use collection ops):

```ts
export async function getFavoriteCleanerIds(customerId: string): Promise<string[]> {
  const doc = await customersCollection().findOne(
    { _id: new ObjectId(customerId) }, { projection: { favoriteCleanerIds: 1 } })
  return (doc?.favoriteCleanerIds as string[] | undefined) ?? []
}
export async function addFavorite(customerId: string, cleanerId: string): Promise<void> {
  await customersCollection().updateOne({ _id: new ObjectId(customerId) },
    { $addToSet: { favoriteCleanerIds: cleanerId }, $set: { lastUpdated: now() } })
}
export async function removeFavorite(customerId: string, cleanerId: string): Promise<void> {
  await customersCollection().updateOne({ _id: new ObjectId(customerId) },
    { $pull: { favoriteCleanerIds: cleanerId }, $set: { lastUpdated: now() } })
}
```

  (Match the file's actual collection accessor/timestamp helpers — read it first; names above are indicative, existing helpers govern.)
  - `cleaner-directory-service.ts`: change `cardFor` to exported.
  - `favorites-service.ts`:

```ts
import * as extrasRepo from '@/server/repositories/customer-extras-repo'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import { cardFor } from '@/server/services/cleaner-directory-service'
import type { CleanerCardOut } from '@/server/schemas/cleaner-directory'
import { AppError } from '@/server/core/errors'

export async function list(customerId: string): Promise<CleanerCardOut[]> {
  const ids = await extrasRepo.getFavoriteCleanerIds(customerId)
  const cards = await Promise.all(ids.map((id) => cardFor(id)))
  return cards.filter((card): card is CleanerCardOut => card !== null)
}
export async function add(customerId: string, cleanerId: string): Promise<void> {
  const cleaner = await cleanerRepo.findById(cleanerId)
  if (!cleaner) throw new AppError(404, 'NOT_FOUND', 'Cleaner not found')
  await extrasRepo.addFavorite(customerId, cleanerId)
}
export async function remove(customerId: string, cleanerId: string): Promise<void> {
  await extrasRepo.removeFavorite(customerId, cleanerId)
}
```

  (Match `AppError` constructor signature to `core/errors.ts` — read it; use its `notFound` factory if one exists.)
  - Routes in `customer-extras.ts` following the `registerAddressList` idiom (guards for `/me/*` already applied): GET `/me/favorites`, PUT + DELETE `/me/favorites/{cleaner_id}` with `envelopeOf(z.array(CleanerCardOut))` and `envelopeOf(z.object({ favorited: z.boolean() }))`.
  - `CustomerDoc`: add `favoriteCleanerIds?: string[]`.

- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(customers): favorite cleaners API`

---

### Task 5: Cleaner settings

**Files:**
- Create: `app/server/services/cleaner-settings-service.ts`
- Modify: `app/server/repositories/cleaner-repo.ts` (add `getSettings`/`updateSettingsSection` mirroring `customer-extras-repo.ts:57-81`), `app/server/routes/cleaner-profile.ts` (settings routes)
- Test: `app/tests/cleaner-settings.test.ts` (new)

**Interfaces:**
- Produces: `GET /api/v1/cleaner/settings` → merged `{notifications: {push, email, sms, marketing}}` over defaults `{push: true, email: true, sms: false, marketing: true}`; `PATCH /api/v1/cleaner/settings/notifications` body `{push?, email?, sms?, marketing?}` (typed, not passthrough) → updated section. Storage: dotted `settings.notifications.*` on the cleaner doc so `cleanerRepo.listMarketingOptOutIds` (`'settings.notifications.marketing': false`) works unchanged.

- [ ] **Step 1: Failing tests** — mocked cleaner-repo settings store: GET returns defaults when unset; PATCH `{marketing: false}` then GET shows `marketing: false` with other defaults intact; PATCH only touches provided keys.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — service mirrors `customer-settings-service.ts` (defaults constant with just the `notifications` section, shallow merge). Repo functions mirror the customer extras ones (dotted `$set`). Routes in `cleaner-profile.ts` (already mounted at `/api/v1/cleaner`, guard `requireCleaner` — follow that file's existing guard/route idiom): GET `/settings`, PATCH `/settings/notifications` with `z.object({push: z.boolean().optional(), email: z.boolean().optional(), sms: z.boolean().optional(), marketing: z.boolean().optional()})`.
- [ ] **Step 4: Run** full suite + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(cleaners): notification settings API with marketing opt-out`

---

### Task 6: Booking hours

**Files:**
- Modify: `app/server/services/pricing-service.ts`, `app/server/schemas/booking.ts`, `app/server/routes/bookings.ts`
- Test: `app/tests/booking-hours.test.ts` (new)

**Interfaces:**
- Produces: `computeQuote(serviceId, addonItems, hours?: number|null)` — when `hours` provided AND the service doc has an hourly rate (same `hourlyRate ?? ratePerHour ?? pricePerHour` coalescing as `catalog-service.pricingOf`), `base = hourlyRate * hours`; hours validated: `hours >= minimumHours (default 1)`, `hours <= maximumHours` when set, `(hours - minimumHours) % hourIncrement === 0` (float-safe: use `Math.round(((hours - min) / inc)) * inc + min ≈ hours` within 1e-6); violation → `AppError(422, 'VALIDATION_FAILED', ...)` with details `{minimumHours, maximumHours, hourIncrement}`. When `hours` provided but the service has no hourly rate → 422 too. When `hours` omitted → exactly today's behavior.
- `BookingQuoteRequest` + `BookingCustomerCreateRequest` gain `hours: z.number().positive().max(24).optional()`. `BookingQuoteOut` gains `hours: z.number().nullable().default(null)`. `BookingOut` gains `hours: z.number().nullable().default(null)`; `BookingDoc` gains `hours?: number|null`. Create stores `hours` on the doc; quote/create both pass it to `computeQuote`.

- [ ] **Step 1: Failing tests** — mock the generic repo (`getDocById`) used by pricing-service with: hourly service `{hourlyRate: 40, minimumHours: 2, hourIncrement: 0.5, maximumHours: 8, currency: 'USD'}` and flat service `{basePrice: 100}`. Cases: hours=3 → base 120; hours below min → 422 with details; hours off-increment (2.7) → 422; hours above max → 422; hours on flat service → 422; no hours on hourly service → base falls back to `basePrice ?? price` (today's behavior); no hours on flat service → 100; addons added on top in all cases. Read `pricing-service.ts` first to mock the exact generic-repo import path.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per interface above; thread `payload.hours ?? null` through `routes/bookings.ts` quote handler (`:214-221`), `computePrice` (`:74-79`) and the `BookingDoc` literal (`:141-165`); include `hours` in the quote response object.
- [ ] **Step 4: Run** full suite + typecheck → PASS (existing booking tests must not break — `hours` optional everywhere).
- [ ] **Step 5: Commit** `feat(bookings): hourly duration pricing on quote and create`

---

### Task 7: Verification pass

- [ ] **Step 1:** `npm test` (full), `npm run typecheck`, `npm run lint` if present — all clean.
- [ ] **Step 2:** Grep sanity: no `sweeping.caf|mopping.caf` anywhere in `server/`; `/config` registered before `/{payment_id}` in payments.ts; no secret key name appears in any response schema.
- [ ] **Step 3:** Update the OpenAPI smoke: hit `/api/reference` generation path if a test exists; otherwise confirm `npm run build` (or `next build` script) succeeds.
- [ ] **Step 4:** Commit any fixes: `chore: gap-closure verification pass`
