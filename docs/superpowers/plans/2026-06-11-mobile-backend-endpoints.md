# Mobile-Facing Backend Endpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the customer- and cleaner-facing endpoints the two Flutter apps need (10 missing + cheap hybrid aliases) onto the existing Next.js/Hono/Mongo backend, following its strict layering.

**Architecture:** Each endpoint is a vertical slice `schema (Zod) → repository (Mongo) → service (pure logic) → route (createRoute + .openapi)`, mounted in `server/app.ts`. Derived data (rating, jobsDone) is aggregated in repos; missing model fields are stubbed (null/empty) and flagged. Pure mappers/derivations are factored out so they unit-test without a live Mongo (matching the repo's current test posture).

**Tech Stack:** Next.js 16, Hono + `@hono/zod-openapi`, MongoDB driver, Zod v4, Vitest, bcryptjs, Resend.

**Spec:** [docs/superpowers/specs/2026-06-11-mobile-backend-endpoints-design.md](../specs/2026-06-11-mobile-backend-endpoints-design.md)

**Conventions (do not deviate):**
- Routers via `createRouter()`; endpoints via `createRoute({...})` + `router.openapi(def, handler)`.
- Success: `return c.json(ok(c, 'message', data), status)`. Errors: throw `AppError` / `badRequest`/`notFound`/`forbidden`/`conflict` from `@/server/core/errors`.
- Guards: `requireCustomer()` / `requireCleaner()` + `principalOf(c)` from `@/server/security/guards`.
- Repos are the ONLY place importing `mongodb`/`getDb`. Services import NO Hono/HTTP types.
- Schemas: `.openapi('Name')` on every exported schema; map `_id`→`id` via `fromDoc` (already done by repo helpers).
- Tests live in `app/tests/**/*.test.ts`, import via `@/server/...`, and set env at top-of-file like `tests/jwt.test.ts`.
- Run all commands from the `app/` directory.

**Commit policy:** `app/CLAUDE.md` forbids Claude/Anthropic co-author trailers and "Generated with" lines. Commit messages in this plan follow that. Commit after each task.

**Verify gate (run before declaring any task done):** `npm run typecheck` && `npm run lint` && `npm test`.

---

## File Structure

**New files**
- `server/schemas/catalog.ts` — `CatalogServiceOut`, `ServiceExtraOut`
- `server/schemas/cleaner-directory.ts` — `CleanerBrowseQuery`, `CleanerCardOut`, `CleanerPublicProfileOut`, `CleanerReviewOut`, `CleanerReviewListOut`, `CleanerReviewQuery`, pure `timePeriodToSince`, `averageRating`
- `server/schemas/cleaner-job.ts` — `CleanerJobOut`, `CleanerJobDeclineRequest`, `CleanerSelfProfileOut`, `CleanerProfileUpdateRequest`, pure `mapBookingToCleanerJob`, `splitFullName`
- `server/schemas/home.ts` — `HomePageModel`, pure `buildGreeting`
- `server/schemas/password-reset.ts` — `PasswordResetRequest`, `PasswordResetConfirm`
- `server/repositories/password-reset-repo.ts` — `password_reset_tokens` TTL collection
- `server/services/catalog-service.ts`
- `server/services/cleaner-directory-service.ts`
- `server/services/home-service.ts`
- `server/services/password-reset-service.ts`
- `server/services/cleaner-jobs-service.ts`
- `server/services/cleaner-profile-service.ts`
- `server/routes/catalog.ts` — mounted `/api/v1/services`
- `server/routes/booking-discovery.ts` — mounted `/api/v1/bookings` (before `bookings`)
- `server/routes/home.ts` — mounted `/api/v1/home`
- `server/routes/cleaner-jobs.ts` — mounted `/api/v1/cleaner`
- `server/routes/cleaner-profile.ts` — mounted `/api/v1/cleaner`
- Tests: `tests/cleaner-job-mapper.test.ts`, `tests/cleaner-directory.test.ts`, `tests/home-greeting.test.ts`, `tests/booking-extras.test.ts`, `tests/cleaner-profile-mapper.test.ts`, `tests/new-schemas.test.ts`

**Modified files**
- `server/schemas/booking.ts` — add optional `extras` alias + `declinedBy` on `BookingDoc`
- `server/schemas/cleaner.ts` — add optional `serviceRadiusMiles`, `availableDays` to `CleanerDoc`
- `server/schemas/review.ts` — extend `ReviewListQuery`
- `server/repositories/review-repo.ts` — `aggregateForCleaner`, `listForCleanerPaginated`
- `server/repositories/booking-repo.ts` — `countForCleaner`, `getCleanerJobFeed`, `addDecline`
- `server/repositories/notifications-repo.ts` — `markAllRead`
- `server/repositories/cleaner-repo.ts` — `listApproved`
- `server/repositories/customer-repo.ts` — `updatePassword`
- `server/services/notifications-service.ts` — `markAllRead`
- `server/services/review-service.ts` — apply `stars`/`timePeriod` filters
- `server/routes/notifications.ts` — `POST /read-all`, `POST /{id}/read`
- `server/routes/reviews.ts` — pass new query params
- `server/routes/bookings.ts` — `extras`→`addons` normalization + `POST /create` alias
- `server/routes/customers.ts` — `/sign-in`, `/sign-up`, `/password-reset/request`, `/password-reset/confirm`
- `server/app.ts` — mount the 5 new routers

---

## Phase 1 — Foundations (schemas, repo derivations, pure helpers)

### Task 1: New schema module — catalog

**Files:**
- Create: `server/schemas/catalog.ts`
- Test: `tests/new-schemas.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/new-schemas.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { CatalogServiceOut, ServiceExtraOut } from '@/server/schemas/catalog'

describe('catalog schemas', () => {
  it('parses a service extra with defaults', () => {
    const e = ServiceExtraOut.parse({ id: 'a1', title: 'Inside oven', price: 20 })
    expect(e).toEqual({ id: 'a1', title: 'Inside oven', price: 20, isAvailable: true })
  })

  it('parses a catalog service with defaults', () => {
    const s = CatalogServiceOut.parse({ id: 's1', title: 'Deep clean' })
    expect(s.isAvailable).toBe(true)
    expect(s.basePrice).toBeNull()
    expect(s.description).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test -- new-schemas`
Expected: FAIL — `Cannot find module '@/server/schemas/catalog'`.

- [ ] **Step 3: Implement** (`server/schemas/catalog.ts`)

```ts
import { z } from '@hono/zod-openapi'

/**
 * Public, read-only projections of the admin `service_definitions` and
 * `addon_catalog` collections (which are `.passthrough()` admin docs). These
 * shapes are intentionally narrow + defensive so customers never see admin
 * internals. See docs/superpowers/specs/2026-06-11-mobile-backend-endpoints-design.md §5.1.3.
 */

export const ServiceExtraOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012addon' }),
    title: z.string().openapi({ example: 'Inside oven' }),
    price: z.number().openapi({ example: 20 }),
    isAvailable: z.boolean().default(true),
  })
  .openapi('ServiceExtraOut')
export type ServiceExtraOut = z.infer<typeof ServiceExtraOut>

export const CatalogServiceOut = z
  .object({
    id: z.string().openapi({ example: '665f1b2c9a1e4b0012service' }),
    title: z.string().openapi({ example: 'Deep clean' }),
    description: z.string().nullable().default(null),
    basePrice: z.number().nullable().default(null),
    isAvailable: z.boolean().default(true),
  })
  .openapi('CatalogServiceOut')
export type CatalogServiceOut = z.infer<typeof CatalogServiceOut>
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npm test -- new-schemas`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schemas/catalog.ts tests/new-schemas.test.ts
git commit -m "feat(schemas): add public catalog projection schemas"
```

---

### Task 2: New schema module — cleaner directory (+ pure helpers)

**Files:**
- Create: `server/schemas/cleaner-directory.ts`
- Test: `tests/cleaner-directory.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/cleaner-directory.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import {
  CleanerCardOut,
  CleanerReviewOut,
  CleanerReviewListOut,
  averageRating,
  timePeriodToSince,
} from '@/server/schemas/cleaner-directory'

describe('cleaner-directory helpers', () => {
  it('averageRating returns 0 for empty', () => {
    expect(averageRating([])).toBe(0)
  })

  it('averageRating rounds to one decimal', () => {
    expect(averageRating([5, 4, 4])).toBe(4.3)
  })

  it('timePeriodToSince maps windows relative to now', () => {
    const now = 1_000_000
    expect(timePeriodToSince('all', now)).toBeUndefined()
    expect(timePeriodToSince('last30Days', now)).toBe(now - 30 * 86400)
    expect(timePeriodToSince('last90Days', now)).toBe(now - 90 * 86400)
    expect(timePeriodToSince('lastYear', now)).toBe(now - 365 * 86400)
  })

  it('CleanerCardOut stubs unknown fields to null', () => {
    const c = CleanerCardOut.parse({ id: 'c1', name: 'Jane D', rating: 4.5, jobsDone: 12 })
    expect(c.hourlyRate).toBeNull()
    expect(c.avatarUrl).toBeNull()
    expect(c.isVerified).toBe(false)
  })

  it('CleanerReviewListOut wraps items + nextCursor', () => {
    const r = CleanerReviewListOut.parse({
      items: [{ id: 'r1', reviewerName: 'Ada', rating: 5, text: 'Great', timestamp: 1 }],
      nextCursor: null,
    })
    expect(r.items[0].avatarUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test -- cleaner-directory`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`server/schemas/cleaner-directory.ts`)

```ts
import { z } from '@hono/zod-openapi'

/**
 * Customer-facing cleaner discovery: browse cards, public profile, and
 * cleaner-scoped reviews. Fields not present in the cleaner data model
 * (hourlyRate, yearsExperience, certifications, avatar) are nullable stubs —
 * see spec §7. rating/jobsDone are DERIVED (reviews / bookings) by the service.
 */

// --- query params ----------------------------------------------------------

export const CleanerBrowseQuery = z
  .object({
    minRating: z.coerce.number().min(0).max(5).optional(),
    maxHourlyRate: z.coerce.number().min(0).optional(),
    onlyAvailableNow: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .openapi('CleanerBrowseQuery')
export type CleanerBrowseQuery = z.infer<typeof CleanerBrowseQuery>

export const ReviewTimePeriod = z.enum(['all', 'last30Days', 'last90Days', 'lastYear'])
export type ReviewTimePeriod = z.infer<typeof ReviewTimePeriod>

export const CleanerReviewQuery = z
  .object({
    cursor: z.string().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
    stars: z.coerce.number().int().min(1).max(5).optional(),
    timePeriod: ReviewTimePeriod.default('all'),
  })
  .openapi('CleanerReviewQuery')
export type CleanerReviewQuery = z.infer<typeof CleanerReviewQuery>

// --- outputs ---------------------------------------------------------------

export const CleanerCardOut = z
  .object({
    id: z.string(),
    name: z.string(),
    rating: z.number().default(0),
    jobsDone: z.number().int().default(0),
    hourlyRate: z.number().nullable().default(null),
    isVerified: z.boolean().default(false),
    avatarUrl: z.string().nullable().default(null),
    roleLabel: z.string().nullable().default(null),
    yearsExperience: z.number().int().nullable().default(null),
    bookingsCount: z.number().int().default(0),
    heroImageUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerCardOut')
export type CleanerCardOut = z.infer<typeof CleanerCardOut>

export const CleanerReviewOut = z
  .object({
    id: z.string(),
    reviewerName: z.string(),
    rating: z.number(),
    text: z.string().nullable().default(null),
    timestamp: z.number().int().nullable().default(null),
    avatarUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerReviewOut')
export type CleanerReviewOut = z.infer<typeof CleanerReviewOut>

export const CleanerReviewListOut = z
  .object({
    items: z.array(CleanerReviewOut),
    nextCursor: z.string().nullable().default(null),
  })
  .openapi('CleanerReviewListOut')
export type CleanerReviewListOut = z.infer<typeof CleanerReviewListOut>

export const CleanerPublicProfileOut = z
  .object({
    id: z.string(),
    name: z.string(),
    yearsExperience: z.number().int().nullable().default(null),
    roleLabel: z.string().nullable().default(null),
    heroImageUrl: z.string().nullable().default(null),
    rating: z.number().default(0),
    reviewsCount: z.number().int().default(0),
    bookingsCount: z.number().int().default(0),
    hourlyRate: z.number().nullable().default(null),
    certifications: z.array(z.string()).default([]),
    about: z.string().nullable().default(null),
    reviewPreview: z.array(CleanerReviewOut).default([]),
  })
  .openapi('CleanerPublicProfileOut')
export type CleanerPublicProfileOut = z.infer<typeof CleanerPublicProfileOut>

// --- pure helpers (unit-tested) --------------------------------------------

/** Mean of ratings, rounded to one decimal; 0 for an empty set. */
export function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0
  const sum = ratings.reduce((a, b) => a + b, 0)
  return Math.round((sum / ratings.length) * 10) / 10
}

/** Convert a time-period token to an inclusive `since` epoch (seconds), or undefined for 'all'. */
export function timePeriodToSince(period: ReviewTimePeriod, now: number): number | undefined {
  switch (period) {
    case 'last30Days':
      return now - 30 * 86400
    case 'last90Days':
      return now - 90 * 86400
    case 'lastYear':
      return now - 365 * 86400
    default:
      return undefined
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npm test -- cleaner-directory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schemas/cleaner-directory.ts tests/cleaner-directory.test.ts
git commit -m "feat(schemas): add cleaner discovery schemas and pure helpers"
```

---

### Task 3: New schema module — cleaner job + self-profile (+ pure mappers)

**Files:**
- Create: `server/schemas/cleaner-job.ts`
- Test: `tests/cleaner-job-mapper.test.ts`, `tests/cleaner-profile-mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/cleaner-job-mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CleanerJobOut, mapBookingToCleanerJob } from '@/server/schemas/cleaner-job'
import type { BookingOut } from '@/server/schemas/booking'

const booking = {
  id: 'b1',
  customer_id: 'cust1',
  cleaner_id: null,
  serviceId: 'svc1',
  place_id: 'ChIJ_addr',
  status: 'PENDING',
  schedule: 1750000000,
  addons: [],
  notes: 'Gate code 1234',
  price: 80,
  currency: 'USD',
  payment_id: null,
  payment_status: 'UNPAID',
  rating: null,
  acceptedAt: null,
  completedAt: null,
  acknowledgedAt: null,
  dateCreated: 1,
  lastUpdated: 1,
} as unknown as BookingOut

describe('mapBookingToCleanerJob', () => {
  it('maps a booking + context into a CleanerJob shape', () => {
    const job = mapBookingToCleanerJob(booking, { title: 'Deep clean', clientName: 'Ada L', address: '12 Main St' })
    expect(job).toMatchObject({
      id: 'b1',
      title: 'Deep clean',
      clientName: 'Ada L',
      address: '12 Main St',
      price: 80,
      scheduledAt: 1750000000,
      status: 'PENDING',
      notes: 'Gate code 1234',
    })
    // stubbed fields
    expect(job.distanceMiles).toBeNull()
    expect(job.isPriority).toBe(false)
    // result is schema-valid
    expect(() => CleanerJobOut.parse(job)).not.toThrow()
  })

  it('falls back to place_id when no address is provided', () => {
    const job = mapBookingToCleanerJob(booking, { title: 'Cleaning', clientName: 'Customer', address: null })
    expect(job.address).toBe('ChIJ_addr')
  })
})
```

`tests/cleaner-profile-mapper.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { splitFullName } from '@/server/schemas/cleaner-job'

describe('splitFullName', () => {
  it('splits first token as firstName, remainder as lastName', () => {
    expect(splitFullName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    expect(splitFullName('Ada King Lovelace')).toEqual({ firstName: 'Ada', lastName: 'King Lovelace' })
  })

  it('handles a single token', () => {
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
  })

  it('trims surrounding whitespace', () => {
    expect(splitFullName('  Ada  Lovelace  ')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })
})
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `npm test -- cleaner-job-mapper cleaner-profile-mapper`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`server/schemas/cleaner-job.ts`)

```ts
import { z } from '@hono/zod-openapi'
import { BookingStatus, type BookingOut } from './booking'

/**
 * Cleaner-app "job" surface. The backend models this work as `bookings`; these
 * schemas + the pure `mapBookingToCleanerJob` adapter translate a BookingOut
 * into the CleanerJob shape the app expects. Fields with no backing data
 * (distanceMiles, isPriority) are stubbed — see spec §7.
 */

export const CleanerJobOut = z
  .object({
    id: z.string(),
    title: z.string(),
    clientName: z.string(),
    scheduledAt: z.number().int().nullable().default(null),
    address: z.string().nullable().default(null),
    price: z.number().nullable().default(null),
    distanceMiles: z.number().nullable().default(null),
    status: BookingStatus,
    notes: z.string().nullable().default(null),
    isPriority: z.boolean().default(false),
  })
  .openapi('CleanerJobOut')
export type CleanerJobOut = z.infer<typeof CleanerJobOut>

export const CleanerJobDeclineRequest = z
  .object({ reason: z.string().nullable().optional() })
  .openapi('CleanerJobDeclineRequest')
export type CleanerJobDeclineRequest = z.infer<typeof CleanerJobDeclineRequest>

export const CleanerSelfProfileOut = z
  .object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string().nullable().default(null),
    bio: z.string().nullable().default(null),
    rating: z.number().default(0),
    reviewsCount: z.number().int().default(0),
    completedJobs: z.number().int().default(0),
    serviceRadiusMiles: z.number().nullable().default(null),
    services: z.array(z.string()).default([]),
    availableDays: z.array(z.string()).default([]),
    avatarUrl: z.string().nullable().default(null),
  })
  .openapi('CleanerSelfProfileOut')
export type CleanerSelfProfileOut = z.infer<typeof CleanerSelfProfileOut>

export const CleanerProfileUpdateRequest = z
  .object({
    fullName: z.string().min(1).optional(),
    email: z.email().optional(),
    phone: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    serviceRadiusMiles: z.number().min(0).nullable().optional(),
    services: z.array(z.string()).optional(),
    availableDays: z.array(z.string()).optional(),
  })
  .openapi('CleanerProfileUpdateRequest')
export type CleanerProfileUpdateRequest = z.infer<typeof CleanerProfileUpdateRequest>

// --- pure adapters (unit-tested) -------------------------------------------

export interface CleanerJobContext {
  title: string
  clientName: string
  address: string | null
}

/** Translate a BookingOut + resolved context into the CleanerJob shape. */
export function mapBookingToCleanerJob(b: BookingOut, ctx: CleanerJobContext): CleanerJobOut {
  return {
    id: b.id,
    title: ctx.title,
    clientName: ctx.clientName,
    scheduledAt: b.schedule,
    address: ctx.address ?? b.place_id,
    price: b.price,
    distanceMiles: null,
    status: b.status,
    notes: b.notes,
    isPriority: false,
  }
}

/** Split a single display name into firstName (first token) + lastName (remainder). */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts.shift() ?? ''
  return { firstName, lastName: parts.join(' ') }
}
```

- [ ] **Step 4: Run them, confirm they pass**

Run: `npm test -- cleaner-job-mapper cleaner-profile-mapper`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schemas/cleaner-job.ts tests/cleaner-job-mapper.test.ts tests/cleaner-profile-mapper.test.ts
git commit -m "feat(schemas): add cleaner job + self-profile schemas and adapters"
```

---

### Task 4: Home schema + greeting helper

**Files:**
- Create: `server/schemas/home.ts`
- Test: `tests/home-greeting.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/home-greeting.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { HomePageModel, buildGreeting } from '@/server/schemas/home'

describe('home schema + greeting', () => {
  it('greets by first name', () => {
    expect(buildGreeting('Ada')).toBe('Welcome back, Ada')
  })

  it('falls back when no name', () => {
    expect(buildGreeting('')).toBe('Welcome back')
    expect(buildGreeting(null)).toBe('Welcome back')
  })

  it('parses a minimal home model with defaults', () => {
    const m = HomePageModel.parse({
      greeting: 'Welcome back, Ada',
      user: { id: 'u1', firstName: 'Ada', lastName: 'L', email: 'a@b.co' },
    })
    expect(m.banners).toEqual([])
    expect(m.serviceCategories).toEqual([])
    expect(m.featuredCleaners).toEqual([])
    expect(m.activeBookings).toEqual([])
    expect(m.recentBookings).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test -- home-greeting`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`server/schemas/home.ts`)

```ts
import { z } from '@hono/zod-openapi'
import { BannerOut } from './banner'
import { CatalogServiceOut } from './catalog'
import { CleanerCardOut } from './cleaner-directory'
import { BookingOut } from './booking'

/**
 * Bespoke home aggregation (spec decision §2.2). Composes existing pieces
 * (banners, catalog, featured cleaners, bookings) into one round-trip payload.
 */

export const HomeUser = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  })
  .openapi('HomeUser')

export const HomePageModel = z
  .object({
    greeting: z.string(),
    user: HomeUser,
    banners: z.array(BannerOut).default([]),
    serviceCategories: z.array(CatalogServiceOut).default([]),
    featuredCleaners: z.array(CleanerCardOut).default([]),
    activeBookings: z.array(BookingOut).default([]),
    recentBookings: z.array(BookingOut).default([]),
  })
  .openapi('HomePageModel')
export type HomePageModel = z.infer<typeof HomePageModel>

/** Build the greeting line from a first name (empty/null → generic). */
export function buildGreeting(firstName: string | null): string {
  return firstName ? `Welcome back, ${firstName}` : 'Welcome back'
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npm test -- home-greeting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schemas/home.ts tests/home-greeting.test.ts
git commit -m "feat(schemas): add home aggregation model + greeting helper"
```

---

### Task 5: Extend booking schema (extras alias + declinedBy)

**Files:**
- Modify: `server/schemas/booking.ts`
- Test: `tests/booking-extras.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/booking-extras.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { BookingCustomerCreateRequest, resolveAddons } from '@/server/schemas/booking'

describe('booking create extras alias', () => {
  it('accepts an extras string[] alias', () => {
    const req = BookingCustomerCreateRequest.parse({
      serviceId: 'svc1',
      placeId: 'ChIJ',
      schedule: 1750000000,
      extras: ['addon1', 'addon2'],
    })
    expect(req.extras).toEqual(['addon1', 'addon2'])
  })

  it('resolveAddons prefers structured addons when present', () => {
    expect(resolveAddons({ addons: [{ addonId: 'a', quantity: 2 }], extras: ['b'] })).toEqual([
      { addonId: 'a', quantity: 2 },
    ])
  })

  it('resolveAddons maps extras ids to addons when addons empty', () => {
    expect(resolveAddons({ addons: [], extras: ['b', 'c'] })).toEqual([
      { addonId: 'b', quantity: 1 },
      { addonId: 'c', quantity: 1 },
    ])
  })

  it('resolveAddons returns [] when neither given', () => {
    expect(resolveAddons({ addons: [], extras: undefined })).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npm test -- booking-extras`
Expected: FAIL — `extras` not accepted / `resolveAddons` not exported.

- [ ] **Step 3: Implement** — edit `server/schemas/booking.ts`

Add `extras` to the request object (insert after the `addons` line inside `BookingCustomerCreateRequest`):

```ts
    addons: z.array(BookingAddon).default([]),
    /** Legacy app alias: a flat list of add-on ids. Coalesced via resolveAddons(). */
    extras: z.array(z.string()).optional(),
    notes: z.string().nullable().optional(),
```

Add this exported helper just below the `BookingCustomerCreateRequest` type export:

```ts
/**
 * Coalesce the structured `addons` and the legacy flat `extras` id-list into the
 * canonical BookingAddon[]. Structured addons win; otherwise each extra id
 * becomes a quantity-1 add-on. See spec §5.3.
 */
export function resolveAddons(input: { addons?: BookingAddon[]; extras?: string[] }): BookingAddon[] {
  if (input.addons && input.addons.length > 0) return input.addons
  if (input.extras && input.extras.length > 0) return input.extras.map((addonId) => ({ addonId, quantity: 1 }))
  return []
}
```

Add `declinedBy` to the `BookingDoc` interface (insert before `dateCreated`):

```ts
  acknowledgedAt?: number | null
  /** Cleaner ids who have passed on this (still-unassigned) job. */
  declinedBy?: string[] | null
  dateCreated: number
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npm test -- booking-extras`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/schemas/booking.ts tests/booking-extras.test.ts
git commit -m "feat(schemas): accept booking extras alias + declinedBy field"
```

---

### Task 6: Repo derivations — reviews aggregate + paginated; bookings count + job feed + decline; notifications mark-all; cleaner listApproved; customer updatePassword; cleaner doc fields

> These are Mongo-touching functions with no live-DB test harness in this repo (see spec §9). Verification is `typecheck` + `lint` (signatures/usage) here; behavior is exercised by the manual/integration step in Task 18.

**Files:**
- Modify: `server/repositories/review-repo.ts`, `server/repositories/booking-repo.ts`, `server/repositories/notifications-repo.ts`, `server/repositories/cleaner-repo.ts`, `server/repositories/customer-repo.ts`, `server/schemas/cleaner.ts`

- [ ] **Step 1: review-repo — add aggregate + paginated list**

Append to `server/repositories/review-repo.ts`:

```ts
/** Average rating + count for a cleaner (derivation source for ratings). */
export async function aggregateForCleaner(cleaner_id: string): Promise<{ average: number; count: number }> {
  await ensureIndexes()
  const rows = await collection()
    .aggregate<{ average: number; count: number }>([
      { $match: { cleaner_id } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      { $project: { _id: 0, average: { $round: [{ $ifNull: ['$average', 0] }, 1] }, count: 1 } },
    ])
    .toArray()
  return rows[0] ?? { average: 0, count: 0 }
}

export interface CleanerReviewPage {
  items: ReviewOutType[]
  nextCursor: string | null
}

/** Cursor-paginated reviews for a cleaner, newest first, with optional star + since filters. */
export async function listForCleanerPaginated(args: {
  cleaner_id: string
  stars?: number
  since?: number
  cursor?: string
  pageSize?: number
}): Promise<CleanerReviewPage> {
  await ensureIndexes()
  const pageSize = args.pageSize && args.pageSize > 0 ? args.pageSize : 10
  const query: Record<string, unknown> = { cleaner_id: args.cleaner_id }
  if (args.stars) query.rating = args.stars
  if (args.since !== undefined) query.dateCreated = { $gte: args.since }
  if (args.cursor) {
    const { toObjectId } = await import('./_helpers')
    query._id = { $lt: toObjectId(args.cursor) }
  }
  const rows = await collection()
    .find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .toArray()
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows
  const nextCursor = hasMore ? String(page[page.length - 1]?._id) : null
  return { items: page.map(toOut), nextCursor }
}
```

- [ ] **Step 2: booking-repo — add count, job feed, decline**

Append to `server/repositories/booking-repo.ts`:

```ts
/** Count bookings for a cleaner (optionally filtered by status). Derivation source for jobsDone. */
export async function countForCleaner(cleaner_id: string, status?: BookingStatus): Promise<number> {
  await ensureIndexes()
  const query: Filter<BookingDoc> = { cleaner_id }
  if (status) query.status = status
  return collection().countDocuments(query)
}

/**
 * Cleaner job feed: jobs assigned to this cleaner PLUS the unassigned PENDING
 * pool, excluding jobs this cleaner has declined. Scheduled ascending.
 */
export async function getCleanerJobFeed(cleanerId: string): Promise<BookingOutType[]> {
  await ensureIndexes()
  const query: Filter<BookingDoc> = {
    $or: [{ cleaner_id: cleanerId }, { cleaner_id: null, status: 'PENDING' }],
    declinedBy: { $ne: cleanerId },
  }
  const rows = await collection().find(query).sort({ schedule: 1 }).toArray()
  return rows.map(parse)
}

/** Record that a cleaner has passed on an (unassigned) job. */
export async function addDecline(bookingId: string, cleanerId: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(bookingId), {
    $addToSet: { declinedBy: cleanerId },
    $set: { lastUpdated: Math.floor(Date.now() / 1000) },
  })
}
```

- [ ] **Step 3: notifications-repo — add markAllRead**

Append to `server/repositories/notifications-repo.ts`:

```ts
/** Mark every notification for a customer as read. Returns the modified count. */
export async function markAllRead(customer_id: string): Promise<number> {
  await ensureIndexes()
  const result = await collection().updateMany(
    { customer_id, read: { $ne: true } },
    { $set: { read: true, lastUpdated: Math.floor(Date.now() / 1000) } },
  )
  return result.modifiedCount
}
```

- [ ] **Step 4: cleaner-repo — add listApproved**

Append to `server/repositories/cleaner-repo.ts`:

```ts
/** All ACTIVE, APPROVED cleaners (directory source). Raw docs for downstream enrichment. */
export async function listApproved(): Promise<WithId<CleanerDoc>[]> {
  await ensureIndexes()
  return collection()
    .find({ onboardingStatus: 'APPROVED', accountStatus: 'ACTIVE' })
    .sort({ dateCreated: -1 })
    .toArray()
}
```

- [ ] **Step 5: customer-repo — add updatePassword**

Append to `server/repositories/customer-repo.ts`:

```ts
/** Set a new bcrypt password hash for a customer. */
export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await ensureIndexes()
  await collection().updateOne(idFilter(id), {
    $set: { password: passwordHash, lastUpdated: Math.floor(Date.now() / 1000) },
  })
}
```

- [ ] **Step 6: cleaner schema — add optional self-profile fields**

In `server/schemas/cleaner.ts`, add to the `CleanerDoc` interface (after `serviceAreaIds`):

```ts
  serviceAreaIds?: string[] | null
  serviceRadiusMiles?: number | null
  availableDays?: string[] | null
```

- [ ] **Step 7: Verify compile**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add server/repositories/review-repo.ts server/repositories/booking-repo.ts server/repositories/notifications-repo.ts server/repositories/cleaner-repo.ts server/repositories/customer-repo.ts server/schemas/cleaner.ts
git commit -m "feat(repos): add derivations for cleaner directory, job feed, decline, mark-all-read"
```

---

## Phase 2 — Customer read surface

### Task 7: Catalog service + `GET /api/v1/services` + service extras

**Files:**
- Create: `server/services/catalog-service.ts`, `server/routes/catalog.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Implement the service** (`server/services/catalog-service.ts`)

```ts
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import { CatalogServiceOut, ServiceExtraOut } from '@/server/schemas/catalog'

/**
 * Public, read-only projection of the admin `service_definitions` and
 * `addon_catalog` collections. Admin docs are `.passthrough()` with an
 * unverified field set, so we read defensively and only surface a narrow,
 * customer-safe shape. See spec §5.1.3.
 */

const SERVICE_DEFS = 'service_definitions'
const ADDON_CATALOG = 'addon_catalog'

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}
function bool(v: unknown, fallback = true): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** List the public service catalog. */
export async function listServices(): Promise<CatalogServiceOut[]> {
  const { items } = await generic.listDocs(SERVICE_DEFS, { limit: 200 })
  return items
    .filter((d) => bool(d.isAvailable ?? d.active, true))
    .map((d) =>
      CatalogServiceOut.parse({
        id: str(d.id),
        title: str(d.title ?? d.name, 'Service'),
        description: typeof d.description === 'string' ? d.description : null,
        basePrice: num(d.basePrice ?? d.price),
        isAvailable: bool(d.isAvailable ?? d.active, true),
      }),
    )
}

/**
 * List add-ons/extras for a service. `addon_catalog` docs may or may not carry a
 * service link; when a link field is present we filter by it, otherwise we
 * return all available add-ons (graceful fallback per spec open item).
 */
export async function listServiceExtras(serviceId: string): Promise<ServiceExtraOut[]> {
  const { items } = await generic.listDocs(ADDON_CATALOG, { limit: 200 })
  const linked = items.filter((d) => {
    const link = d.serviceId ?? d.serviceDefinitionId ?? d.service_id
    return link === undefined || link === null ? null : link === serviceId
  })
  // If no doc carries a link field at all, `linked` is empty → fall back to all.
  const anyLinked = items.some(
    (d) => (d.serviceId ?? d.serviceDefinitionId ?? d.service_id) !== undefined,
  )
  const source = anyLinked ? linked : items
  return source
    .filter((d) => bool(d.isAvailable ?? d.active, true))
    .map((d) =>
      ServiceExtraOut.parse({
        id: str(d.id),
        title: str(d.title ?? d.name, 'Add-on'),
        price: num(d.price) ?? 0,
        isAvailable: bool(d.isAvailable ?? d.active, true),
      }),
    )
}
```

- [ ] **Step 2: Implement the route** (`server/routes/catalog.ts`)

```ts
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer } from '@/server/security/guards'
import { CatalogServiceOut } from '@/server/schemas/catalog'
import * as catalogService from '@/server/services/catalog-service'

/** /v1/services — public, read-only service catalog (customer-guarded). */
export const catalog = createRouter()

catalog.use('/', requireCustomer())

catalog.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Catalog'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Services', content: { 'application/json': { schema: envelopeOf(z.array(CatalogServiceOut)) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const items = await catalogService.listServices()
    return c.json(ok(c, 'Services fetched successfully', items), 200)
  },
)
```

- [ ] **Step 3: Mount in `server/app.ts`**

Add the import near the other route imports:

```ts
import { catalog } from './routes/catalog'
```

Add the mount in the routers section (after the `reviews` mount):

```ts
app.route('/api/v1/services', catalog)
```

- [ ] **Step 4: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/catalog-service.ts server/routes/catalog.ts server/app.ts
git commit -m "feat(catalog): public service catalog endpoint"
```

---

### Task 8: Cleaner directory service (browse, public profile, reviews)

**Files:**
- Create: `server/services/cleaner-directory-service.ts`

- [ ] **Step 1: Implement** (`server/services/cleaner-directory-service.ts`)

```ts
import { notFound } from '@/server/core/errors'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as reviewRepo from '@/server/repositories/review-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import {
  CleanerCardOut,
  CleanerPublicProfileOut,
  CleanerReviewOut,
  CleanerReviewListOut,
  timePeriodToSince,
  type CleanerBrowseQuery,
  type CleanerReviewQuery,
} from '@/server/schemas/cleaner-directory'
import type { ReviewOut } from '@/server/schemas/review'

/**
 * Customer-facing cleaner discovery. rating/reviewsCount derive from `reviews`,
 * jobsDone/bookingsCount from `bookings`; model-absent fields (hourlyRate,
 * yearsExperience, certifications, avatar) are null/empty stubs. See spec §7.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

async function reviewerName(customerId: string): Promise<string> {
  const c = await customerRepo.findById(customerId)
  if (!c) return 'Customer'
  return `${c.firstName} ${c.lastName}`.trim() || 'Customer'
}

async function toCleanerReview(r: ReviewOut): Promise<CleanerReviewOut> {
  return CleanerReviewOut.parse({
    id: r.id,
    reviewerName: await reviewerName(r.customer_id),
    rating: r.rating,
    text: r.comment,
    timestamp: r.dateCreated,
    avatarUrl: null,
  })
}

/** Browse approved cleaners as cards, with derived rating/jobs and client-side filters. */
export async function browse(filter: CleanerBrowseQuery): Promise<CleanerCardOut[]> {
  const cleaners = await cleanerRepo.listApproved()
  const cards = await Promise.all(
    cleaners.map(async (doc) => {
      const id = String(doc._id)
      const [agg, bookingsCount] = await Promise.all([
        reviewRepo.aggregateForCleaner(id),
        bookingRepo.countForCleaner(id),
      ])
      return CleanerCardOut.parse({
        id,
        name: `${doc.firstName} ${doc.lastName}`.trim(),
        rating: agg.average,
        jobsDone: await bookingRepo.countForCleaner(id, 'COMPLETED'),
        hourlyRate: null,
        isVerified: doc.onboardingStatus === 'APPROVED',
        avatarUrl: null,
        roleLabel: 'Cleaner',
        yearsExperience: null,
        bookingsCount,
        heroImageUrl: null,
      })
    }),
  )
  return cards.filter((card) => {
    if (filter.minRating !== undefined && card.rating < filter.minRating) return false
    if (filter.maxHourlyRate !== undefined && card.hourlyRate !== null && card.hourlyRate > filter.maxHourlyRate)
      return false
    return true // onlyAvailableNow has no backing data yet — no-op (spec §7)
  })
}

/** Public profile for one cleaner, with a short review preview. */
export async function getPublicProfile(cleanerId: string): Promise<CleanerPublicProfileOut> {
  const doc = await cleanerRepo.findById(cleanerId)
  if (!doc || doc.onboardingStatus !== 'APPROVED') throw notFound('Cleaner not found')
  const [agg, bookingsCount, recent] = await Promise.all([
    reviewRepo.aggregateForCleaner(cleanerId),
    bookingRepo.countForCleaner(cleanerId),
    reviewRepo.listForCleanerPaginated({ cleaner_id: cleanerId, pageSize: 3 }),
  ])
  const reviewPreview = await Promise.all(recent.items.map(toCleanerReview))
  return CleanerPublicProfileOut.parse({
    id: cleanerId,
    name: `${doc.firstName} ${doc.lastName}`.trim(),
    yearsExperience: null,
    roleLabel: 'Cleaner',
    heroImageUrl: null,
    rating: agg.average,
    reviewsCount: agg.count,
    bookingsCount,
    hourlyRate: null,
    certifications: [],
    about: doc.bio ?? null,
    reviewPreview,
  })
}

/** Cursor-paginated, filterable reviews for one cleaner. */
export async function listCleanerReviews(
  cleanerId: string,
  query: CleanerReviewQuery,
): Promise<CleanerReviewListOut> {
  const since = timePeriodToSince(query.timePeriod, nowEpoch())
  const page = await reviewRepo.listForCleanerPaginated({
    cleaner_id: cleanerId,
    stars: query.stars,
    since,
    cursor: query.cursor,
    pageSize: query.pageSize,
  })
  const items = await Promise.all(page.items.map(toCleanerReview))
  return CleanerReviewListOut.parse({ items, nextCursor: page.nextCursor })
}
```

- [ ] **Step 2: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/cleaner-directory-service.ts
git commit -m "feat(cleaner-directory): browse, public profile, paginated reviews service"
```

---

### Task 9: Booking-discovery router (cleaners browse/profile/reviews + service extras)

**Files:**
- Create: `server/routes/booking-discovery.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Implement** (`server/routes/booking-discovery.ts`)

```ts
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer } from '@/server/security/guards'
import {
  CleanerBrowseQuery,
  CleanerCardOut,
  CleanerPublicProfileOut,
  CleanerReviewListOut,
  CleanerReviewQuery,
} from '@/server/schemas/cleaner-directory'
import { ServiceExtraOut } from '@/server/schemas/catalog'
import * as directory from '@/server/services/cleaner-directory-service'
import * as catalogService from '@/server/services/catalog-service'

/**
 * /v1/bookings discovery sub-surface: customer-facing cleaner browse/profile/
 * reviews and per-service extras. Mounted at /api/v1/bookings BEFORE the main
 * bookings router so its static segments (`cleaners`, `services`) take priority
 * over the booking-id param routes. All customer-guarded.
 */
export const bookingDiscovery = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const cleanerIdParam = z.object({
  cleanerId: z.string().openapi({ param: { name: 'cleanerId', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})
const serviceIdParam = z.object({
  serviceId: z.string().openapi({ param: { name: 'serviceId', in: 'path' }, example: '665f1b2c9a1e4b0012service' }),
})

bookingDiscovery.use('/cleaners', requireCustomer())
bookingDiscovery.use('/cleaners/*', requireCustomer())
bookingDiscovery.use('/services/*', requireCustomer())

// GET /cleaners — browse
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { query: CleanerBrowseQuery },
    responses: {
      200: { description: 'Cleaners', content: { 'application/json': { schema: envelopeOf(z.array(CleanerCardOut)) } } },
      401: errs[401],
      422: errs[422],
    },
  }),
  async (c) => {
    const items = await directory.browse(c.req.valid('query'))
    return c.json(ok(c, 'Cleaners fetched successfully', items), 200)
  },
)

// GET /cleaners/{cleanerId} — public profile
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners/{cleanerId}',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: cleanerIdParam },
    responses: {
      200: { description: 'Cleaner profile', content: { 'application/json': { schema: envelopeOf(CleanerPublicProfileOut) } } },
      401: errs[401],
      404: errs[404],
    },
  }),
  async (c) => {
    const { cleanerId } = c.req.valid('param')
    const profile = await directory.getPublicProfile(cleanerId)
    return c.json(ok(c, 'Cleaner profile fetched successfully', profile), 200)
  },
)

// GET /cleaners/{cleanerId}/reviews — paginated
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/cleaners/{cleanerId}/reviews',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: cleanerIdParam, query: CleanerReviewQuery },
    responses: {
      200: { description: 'Cleaner reviews', content: { 'application/json': { schema: envelopeOf(CleanerReviewListOut) } } },
      401: errs[401],
      422: errs[422],
    },
  }),
  async (c) => {
    const { cleanerId } = c.req.valid('param')
    const result = await directory.listCleanerReviews(cleanerId, c.req.valid('query'))
    return c.json(ok(c, 'Cleaner reviews fetched successfully', result), 200)
  },
)

// GET /services/{serviceId}/extras
bookingDiscovery.openapi(
  createRoute({
    method: 'get',
    path: '/services/{serviceId}/extras',
    tags: ['Cleaner Discovery'],
    security: [{ bearerAuth: [] }],
    request: { params: serviceIdParam },
    responses: {
      200: { description: 'Service extras', content: { 'application/json': { schema: envelopeOf(z.array(ServiceExtraOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const { serviceId } = c.req.valid('param')
    const items = await catalogService.listServiceExtras(serviceId)
    return c.json(ok(c, 'Service extras fetched successfully', items), 200)
  },
)
```

- [ ] **Step 2: Mount in `server/app.ts` — BEFORE the bookings mount**

Add import:

```ts
import { bookingDiscovery } from './routes/booking-discovery'
```

Change the bookings mount block so discovery is mounted first:

```ts
app.route('/api/v1/bookings', bookingDiscovery)
app.route('/api/v1/bookings', bookings)
```

- [ ] **Step 3: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Route-priority smoke test**

Run: `npx tsx -e "import('./server/app').then(async ({app}) => { const r = await app.request('/api/v1/bookings/cleaners'); console.log('status', r.status) })"`
Expected: status `401` (the requireCustomer guard fires) — NOT `404`. A `404` means the `/{booking_id}` route shadowed `/cleaners`; if so, ensure `bookingDiscovery` is mounted before `bookings` and re-run.

> If `tsx` is unavailable, instead add a temporary Vitest in `tests/route-priority.test.ts` calling `app.request('/api/v1/bookings/cleaners')` and asserting `res.status === 401`, then delete it after confirming.

- [ ] **Step 5: Commit**

```bash
git add server/routes/booking-discovery.ts server/app.ts
git commit -m "feat(bookings): cleaner discovery + service extras endpoints"
```

---

## Phase 3 — Home aggregator

### Task 10: Home service + route

**Files:**
- Create: `server/services/home-service.ts`, `server/routes/home.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Implement the service** (`server/services/home-service.ts`)

```ts
import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as bannerRepo from '@/server/repositories/banner-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as catalogService from '@/server/services/catalog-service'
import * as directory from '@/server/services/cleaner-directory-service'
import { HomePageModel, buildGreeting } from '@/server/schemas/home'

/** Bespoke home aggregation for the customer app (spec §2.2). Composes existing repos/services. */
export async function getHome(principal: AuthPrincipal): Promise<HomePageModel> {
  const customer = await customerRepo.findById(principal.userId)
  if (!customer) throw notFound('Customer not found')

  const [banners, serviceCategories, featuredCleaners, upcoming, past] = await Promise.all([
    bannerRepo.list(),
    catalogService.listServices(),
    directory.browse({}),
    bookingRepo.getBookingsHistory({ customerId: principal.userId, scope: 'upcoming', pageSize: 5 }),
    bookingRepo.getBookingsHistory({ customerId: principal.userId, scope: 'past', pageSize: 5 }),
  ])

  return HomePageModel.parse({
    greeting: buildGreeting(customer.firstName),
    user: {
      id: String(customer._id),
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
    },
    banners: banners.filter((b) => b.active),
    serviceCategories,
    featuredCleaners: featuredCleaners.slice(0, 5),
    activeBookings: upcoming.items,
    recentBookings: past.items,
  })
}
```

- [ ] **Step 2: Implement the route** (`server/routes/home.ts`)

```ts
import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCustomer, principalOf } from '@/server/security/guards'
import { HomePageModel } from '@/server/schemas/home'
import * as homeService from '@/server/services/home-service'

/** /v1/home — bespoke customer home aggregation. */
export const home = createRouter()

home.use('/', requireCustomer())

home.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Home'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Home', content: { 'application/json': { schema: envelopeOf(HomePageModel) } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  }),
  async (c) => {
    const data = await homeService.getHome(principalOf(c))
    return c.json(ok(c, 'Home fetched successfully', data), 200)
  },
)
```

- [ ] **Step 3: Mount in `server/app.ts`**

```ts
import { home } from './routes/home'
```

```ts
app.route('/api/v1/home', home)
```

- [ ] **Step 4: Verify compile + lint + tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/home-service.ts server/routes/home.ts server/app.ts
git commit -m "feat(home): bespoke home aggregation endpoint"
```

---

## Phase 4 — Notifications mark-all-read + read alias

### Task 11: notifications-service.markAllRead + routes

**Files:**
- Modify: `server/services/notifications-service.ts`, `server/routes/notifications.ts`

- [ ] **Step 1: Add the service function** — append to `server/services/notifications-service.ts`

```ts
/** Mark all of the calling customer's notifications as read. Returns the count updated. */
export async function markAllRead(args: { principal: AuthPrincipal }): Promise<{ updated: number }> {
  const updated = await notificationsRepo.markAllRead(args.principal.userId)
  return { updated }
}
```

- [ ] **Step 2: Add routes** — in `server/routes/notifications.ts`

Add guards next to the existing ones:

```ts
notifications.use('/read-all', requireCustomer())
notifications.use('/{id}/read', requireCustomer())
```

Add the `read-all` route (place after the `GET /` route):

```ts
// POST /read-all
notifications.openapi(
  createRoute({
    method: 'post',
    path: '/read-all',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'All marked read', content: { 'application/json': { schema: envelopeOf(z.object({ updated: z.number().int() })) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const result = await notificationsService.markAllRead({ principal: principalOf(c) })
    return c.json(ok(c, 'All notifications marked as read', result), 200)
  },
)

// POST /{id}/read — hybrid alias for the app's POST mark-read (PATCH /{id} still works)
notifications.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/read',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    request: { params: IdParam },
    responses: {
      200: { description: 'Notification marked read', content: { 'application/json': { schema: envelopeOf(NotificationOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param')
    const notification = await notificationsService.updateNotification({
      principal: principalOf(c),
      id,
      payload: { read: true },
    })
    return c.json(ok(c, 'Notification marked as read', notification), 200)
  },
)
```

- [ ] **Step 3: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/notifications-service.ts server/routes/notifications.ts
git commit -m "feat(notifications): mark-all-read + POST mark-read alias"
```

---

## Phase 5 — Password reset

### Task 12: password_reset_tokens repo (TTL)

**Files:**
- Create: `server/repositories/password-reset-repo.ts`

- [ ] **Step 1: Implement** (`server/repositories/password-reset-repo.ts`)

```ts
import type { Collection } from 'mongodb'
import { getDb } from '@/server/core/mongo'
import { sha256 } from '@/server/security/hash'

/**
 * Single-use, time-boxed password-reset tokens. Mongo TTL purges expired docs
 * automatically (index on `expiresAt` with expireAfterSeconds: 0). Only the
 * sha256 hash of the token is stored — the plaintext lives only in the email.
 * Mirrors the sessions / oauth_states TTL pattern. See spec §5.1.1.
 */

interface ResetTokenDoc {
  customerId: string
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

let indexesReady = false

function collection(): Collection<ResetTokenDoc> {
  return getDb().collection<ResetTokenDoc>('password_reset_tokens')
}

async function ensureIndexes(): Promise<void> {
  if (indexesReady) return
  await collection().createIndex({ tokenHash: 1 }, { name: 'idx_reset_token_hash', unique: true })
  await collection().createIndex({ expiresAt: 1 }, { name: 'idx_reset_token_ttl', expireAfterSeconds: 0 })
  indexesReady = true
}

/** Store a reset token (hashed) for a customer. */
export async function issue(args: { customerId: string; token: string; expiresAt: Date }): Promise<void> {
  await ensureIndexes()
  await collection().insertOne({
    customerId: args.customerId,
    tokenHash: sha256(args.token),
    expiresAt: args.expiresAt,
    createdAt: new Date(),
  })
}

/**
 * Consume a token: if a non-expired match exists, delete it and return the
 * customer id; otherwise return null. Single-use (deleteOne on match).
 */
export async function consume(token: string): Promise<string | null> {
  await ensureIndexes()
  const doc = await collection().findOneAndDelete({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  })
  return doc?.customerId ?? null
}
```

- [ ] **Step 2: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/repositories/password-reset-repo.ts
git commit -m "feat(repos): password-reset token store with TTL"
```

---

### Task 13: password-reset service + schemas + routes

**Files:**
- Create: `server/schemas/password-reset.ts`, `server/services/password-reset-service.ts`
- Modify: `server/routes/customers.ts`

- [ ] **Step 1: Implement schemas** (`server/schemas/password-reset.ts`)

```ts
import { z } from '@hono/zod-openapi'

export const PasswordResetRequest = z
  .object({ email: z.email().openapi({ example: 'ada@example.com' }) })
  .openapi('PasswordResetRequest')
export type PasswordResetRequest = z.infer<typeof PasswordResetRequest>

export const PasswordResetConfirm = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8).openapi({ example: 'sup3r-secret' }),
  })
  .openapi('PasswordResetConfirm')
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirm>
```

- [ ] **Step 2: Implement the service** (`server/services/password-reset-service.ts`)

```ts
import { badRequest } from '@/server/core/errors'
import { generateRefreshToken, hashPassword } from '@/server/security/hash'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as resetRepo from '@/server/repositories/password-reset-repo'
import { sendPasswordResetEmail } from '@/server/core/email/send'

/**
 * Password reset (spec §5.1.1). `requestReset` ALWAYS resolves without revealing
 * whether the email exists (no enumeration). No HTTP types here — the URL builder
 * is injected by the route so this stays reusable/testable.
 */

const TOKEN_TTL_SECONDS = 30 * 60

/** Issue a reset token + email it, if the email maps to a customer. Never throws on unknown email. */
export async function requestReset(email: string, buildResetUrl: (token: string) => string): Promise<void> {
  const customer = await customerRepo.findByEmail(email)
  if (!customer) return // silent — avoids account enumeration
  const token = generateRefreshToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)
  await resetRepo.issue({ customerId: String(customer._id), token, expiresAt })
  await sendPasswordResetEmail({ to: customer.email, resetUrl: buildResetUrl(token) })
}

/** Validate a token and set a new password. 400 on invalid/expired token. */
export async function confirmReset(token: string, newPassword: string): Promise<void> {
  const customerId = await resetRepo.consume(token)
  if (!customerId) throw badRequest('Invalid or expired reset token')
  const hash = await hashPassword(newPassword)
  await customerRepo.updatePassword(customerId, hash)
}
```

- [ ] **Step 3: Add routes** — in `server/routes/customers.ts`

Add imports:

```ts
import { PasswordResetRequest, PasswordResetConfirm } from '@/server/schemas/password-reset'
import * as passwordResetService from '@/server/services/password-reset-service'
```

Add the routes (after the `refresh` route):

```ts
// POST /password-reset/request — always 200 (no email enumeration)
customers.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/request',
    tags: ['Customers'],
    request: { body: { content: { 'application/json': { schema: PasswordResetRequest } } } },
    responses: {
      200: { description: 'Reset requested', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      ...commonErrors,
    },
  }),
  async (c) => {
    const { email } = c.req.valid('json')
    const origin = new URL(c.req.url).origin
    await passwordResetService.requestReset(email, (token) => `${origin}/reset-password?token=${token}`)
    return c.json(ok(c, 'If that email exists, a reset link has been sent', null), 200)
  },
)

// POST /password-reset/confirm
customers.openapi(
  createRoute({
    method: 'post',
    path: '/password-reset/confirm',
    tags: ['Customers'],
    request: { body: { content: { 'application/json': { schema: PasswordResetConfirm } } } },
    responses: {
      200: { description: 'Password reset', content: { 'application/json': { schema: envelopeOf(z.null()) } } },
      400: { description: 'Invalid or expired token', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...commonErrors,
    },
  }),
  async (c) => {
    const { token, newPassword } = c.req.valid('json')
    await passwordResetService.confirmReset(token, newPassword)
    return c.json(ok(c, 'Password reset successfully', null), 200)
  },
)
```

- [ ] **Step 4: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors. (`z`, `ok`, `envelopeOf`, `ErrorEnvelope`, `commonErrors` are already imported in `customers.ts`.)

- [ ] **Step 5: Commit**

```bash
git add server/schemas/password-reset.ts server/services/password-reset-service.ts server/routes/customers.ts
git commit -m "feat(customers): password-reset request + confirm"
```

---

## Phase 6 — Cleaner surface (jobs + profile)

### Task 14: cleaner-jobs service

**Files:**
- Create: `server/services/cleaner-jobs-service.ts`

- [ ] **Step 1: Implement** (`server/services/cleaner-jobs-service.ts`)

```ts
import { badRequest, notFound, forbidden } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import { loadCleanerBooking } from '@/server/security/booking-access'
import { applyTransition } from '@/server/services/booking-state-machine'
import * as bookingRepo from '@/server/repositories/booking-repo'
import * as customerRepo from '@/server/repositories/customer-repo'
import * as generic from '@/server/repositories/admin-features/_generic-repo'
import { mapBookingToCleanerJob, type CleanerJobOut } from '@/server/schemas/cleaner-job'
import type { BookingOut } from '@/server/schemas/booking'

/**
 * Cleaner "jobs" surface mapped over the `bookings` collection (spec §2.3, §5.2).
 * Decline = "this cleaner passes; the booking stays in the pool" (spec §8): it
 * records the cleaner in `declinedBy` and removes the job from their feed; the
 * booking status is unchanged.
 */

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

async function clientName(customerId: string): Promise<string> {
  const c = await customerRepo.findById(customerId)
  if (!c) return 'Customer'
  return `${c.firstName} ${c.lastName}`.trim() || 'Customer'
}

async function serviceTitle(serviceId: string | null): Promise<string> {
  if (!serviceId) return 'Cleaning'
  const doc = await generic.getDocById('service_definitions', serviceId)
  const title = doc?.title ?? doc?.name
  return typeof title === 'string' ? title : 'Cleaning'
}

/** Enrich a BookingOut into a CleanerJob (resolves client name, service title, address). */
async function enrich(b: BookingOut): Promise<CleanerJobOut> {
  const [name, title] = await Promise.all([clientName(b.customer_id), serviceTitle(b.serviceId)])
  return mapBookingToCleanerJob(b, { title, clientName: name, address: null })
}

/** The cleaner's job feed: assigned + unassigned pool, minus declined. */
export async function listJobs(principal: AuthPrincipal): Promise<CleanerJobOut[]> {
  const bookings = await bookingRepo.getCleanerJobFeed(principal.userId)
  return Promise.all(bookings.map(enrich))
}

/** A single job, visible to this cleaner (assigned to them or an open pool job). */
export async function getJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await bookingRepo.getBookingById(jobId)
  if (!booking) throw notFound('Job not found')
  const isAssignedToMe = booking.cleaner_id === principal.userId
  const isOpenPool = booking.cleaner_id === null && booking.status === 'PENDING'
  if (!isAssignedToMe && !isOpenPool) throw forbidden('You cannot view this job')
  return enrich(booking)
}

/** Accept a job: claim it + transition PENDING→ACCEPTED. */
export async function acceptJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await loadCleanerBooking(principal, jobId, { allowUnassigned: true })
  const status = applyTransition(booking.status, 'ACCEPTED')
  const updated = await bookingRepo.updateBooking(booking.id, {
    status,
    cleaner_id: principal.userId,
    acceptedAt: nowEpoch(),
    lastUpdated: nowEpoch(),
  })
  return enrich(updated!)
}

/** Decline a job: only valid for open pool jobs not yet accepted by this cleaner. */
export async function declineJob(principal: AuthPrincipal, jobId: string): Promise<CleanerJobOut> {
  const booking = await bookingRepo.getBookingById(jobId)
  if (!booking) throw notFound('Job not found')
  if (booking.cleaner_id && booking.cleaner_id !== principal.userId) {
    throw badRequest('This job is already assigned to another cleaner')
  }
  if (booking.cleaner_id === principal.userId) {
    throw badRequest('You have already accepted this job; use cancel instead')
  }
  await bookingRepo.addDecline(jobId, principal.userId)
  return enrich(booking)
}
```

> Note: `loadCleanerBooking(principal, id, { allowUnassigned: true })` is the same helper the existing `POST /bookings/{id}/accept` handler uses (`server/routes/bookings.ts:228`). Confirm its signature returns an object with `.id` and `.status` (it returns a `BookingOut`-like view).

- [ ] **Step 2: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/cleaner-jobs-service.ts
git commit -m "feat(cleaner-jobs): job feed/get/accept/decline service over bookings"
```

---

### Task 15: cleaner-jobs route

**Files:**
- Create: `server/routes/cleaner-jobs.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Implement** (`server/routes/cleaner-jobs.ts`)

```ts
import { createRoute, z } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerJobOut, CleanerJobDeclineRequest } from '@/server/schemas/cleaner-job'
import * as jobsService from '@/server/services/cleaner-jobs-service'

/**
 * /v1/cleaner/jobs — cleaner-scoped job feed (mapped from bookings).
 * Mounted at /api/v1/cleaner (distinct from the /cleaners auth router).
 */
export const cleanerJobs = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

const jobIdParam = z.object({
  jobId: z.string().openapi({ param: { name: 'jobId', in: 'path' }, example: '665f1b2c9a1e4b0012abcd34' }),
})

cleanerJobs.use('/jobs', requireCleaner())
cleanerJobs.use('/jobs/*', requireCleaner())

// GET /jobs
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Jobs', content: { 'application/json': { schema: envelopeOf(z.array(CleanerJobOut)) } } },
      401: errs[401],
    },
  }),
  async (c) => {
    const items = await jobsService.listJobs(principalOf(c))
    return c.json(ok(c, 'Jobs fetched successfully', items), 200)
  },
)

// GET /jobs/{jobId}
cleanerJobs.openapi(
  createRoute({
    method: 'get',
    path: '/jobs/{jobId}',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const job = await jobsService.getJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job fetched successfully', job), 200)
  },
)

// POST /jobs/{jobId}/accept
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/accept',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam },
    responses: {
      200: { description: 'Job accepted', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      400: { description: 'Illegal transition', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    const job = await jobsService.acceptJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job accepted successfully', job), 200)
  },
)

// POST /jobs/{jobId}/decline
cleanerJobs.openapi(
  createRoute({
    method: 'post',
    path: '/jobs/{jobId}/decline',
    tags: ['Cleaner Jobs'],
    security: [{ bearerAuth: [] }],
    request: { params: jobIdParam, body: { content: { 'application/json': { schema: CleanerJobDeclineRequest } } } },
    responses: {
      200: { description: 'Job declined', content: { 'application/json': { schema: envelopeOf(CleanerJobOut) } } },
      400: { description: 'Cannot decline', content: { 'application/json': { schema: ErrorEnvelope } } },
      ...errs,
    },
  }),
  async (c) => {
    const { jobId } = c.req.valid('param')
    c.req.valid('json') // reason is accepted (and currently advisory)
    const job = await jobsService.declineJob(principalOf(c), jobId)
    return c.json(ok(c, 'Job declined successfully', job), 200)
  },
)
```

- [ ] **Step 2: Mount in `server/app.ts`**

```ts
import { cleanerJobs } from './routes/cleaner-jobs'
```

```ts
app.route('/api/v1/cleaner', cleanerJobs)
```

- [ ] **Step 3: Verify compile + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/routes/cleaner-jobs.ts server/app.ts
git commit -m "feat(cleaner-jobs): job feed/get/accept/decline routes"
```

---

### Task 16: cleaner self-profile service + route

**Files:**
- Create: `server/services/cleaner-profile-service.ts`, `server/routes/cleaner-profile.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Implement the service** (`server/services/cleaner-profile-service.ts`)

```ts
import { notFound } from '@/server/core/errors'
import type { AuthPrincipal } from '@/server/security/principal'
import * as cleanerRepo from '@/server/repositories/cleaner-repo'
import * as reviewRepo from '@/server/repositories/review-repo'
import * as bookingRepo from '@/server/repositories/booking-repo'
import {
  CleanerSelfProfileOut,
  splitFullName,
  type CleanerProfileUpdateRequest,
} from '@/server/schemas/cleaner-job'
import type { CleanerDoc } from '@/server/schemas/cleaner'
import type { WithId } from 'mongodb'

/** Cleaner self-profile read/update (spec §5.2.11). Derives rating/reviews/completedJobs. */

async function toSelfProfile(doc: WithId<CleanerDoc>): Promise<CleanerSelfProfileOut> {
  const id = String(doc._id)
  const [agg, completedJobs] = await Promise.all([
    reviewRepo.aggregateForCleaner(id),
    bookingRepo.countForCleaner(id, 'COMPLETED'),
  ])
  return CleanerSelfProfileOut.parse({
    id,
    fullName: `${doc.firstName} ${doc.lastName}`.trim(),
    email: doc.email,
    phone: doc.phoneNumber ?? null,
    bio: doc.bio ?? null,
    rating: agg.average,
    reviewsCount: agg.count,
    completedJobs,
    serviceRadiusMiles: doc.serviceRadiusMiles ?? null,
    services: doc.skills ?? [],
    availableDays: doc.availableDays ?? [],
    avatarUrl: null,
  })
}

export async function getSelf(principal: AuthPrincipal): Promise<CleanerSelfProfileOut> {
  const doc = await cleanerRepo.findById(principal.userId)
  if (!doc) throw notFound('Cleaner not found')
  return toSelfProfile(doc)
}

export async function updateSelf(
  principal: AuthPrincipal,
  patch: CleanerProfileUpdateRequest,
): Promise<CleanerSelfProfileOut> {
  const update: Partial<CleanerDoc> = {}
  if (patch.fullName !== undefined) {
    const { firstName, lastName } = splitFullName(patch.fullName)
    update.firstName = firstName
    update.lastName = lastName
  }
  if (patch.email !== undefined) update.email = patch.email.toLowerCase()
  if (patch.phone !== undefined) update.phoneNumber = patch.phone
  if (patch.bio !== undefined) update.bio = patch.bio
  if (patch.serviceRadiusMiles !== undefined) update.serviceRadiusMiles = patch.serviceRadiusMiles
  if (patch.services !== undefined) update.skills = patch.services
  if (patch.availableDays !== undefined) update.availableDays = patch.availableDays

  await cleanerRepo.updateCleaner(principal.userId, update)
  const doc = await cleanerRepo.findById(principal.userId)
  if (!doc) throw notFound('Cleaner not found')
  return toSelfProfile(doc)
}
```

- [ ] **Step 2: Implement the route** (`server/routes/cleaner-profile.ts`)

```ts
import { createRoute } from '@hono/zod-openapi'
import { createRouter } from '@/server/core/router'
import { ok, envelopeOf, ErrorEnvelope } from '@/server/core/envelope'
import { requireCleaner, principalOf } from '@/server/security/guards'
import { CleanerSelfProfileOut, CleanerProfileUpdateRequest } from '@/server/schemas/cleaner-job'
import * as profileService from '@/server/services/cleaner-profile-service'

/** /v1/cleaner/profile — cleaner self profile read + update. Mounted at /api/v1/cleaner. */
export const cleanerProfile = createRouter()

const errs = {
  401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorEnvelope } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorEnvelope } } },
  422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
}

cleanerProfile.use('/profile', requireCleaner())

cleanerProfile.openapi(
  createRoute({
    method: 'get',
    path: '/profile',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: 'Profile', content: { 'application/json': { schema: envelopeOf(CleanerSelfProfileOut) } } },
      401: errs[401],
      404: errs[404],
    },
  }),
  async (c) => {
    const profile = await profileService.getSelf(principalOf(c))
    return c.json(ok(c, 'Profile fetched successfully', profile), 200)
  },
)

cleanerProfile.openapi(
  createRoute({
    method: 'patch',
    path: '/profile',
    tags: ['Cleaner Profile'],
    security: [{ bearerAuth: [] }],
    request: { body: { content: { 'application/json': { schema: CleanerProfileUpdateRequest } } } },
    responses: {
      200: { description: 'Profile updated', content: { 'application/json': { schema: envelopeOf(CleanerSelfProfileOut) } } },
      ...errs,
    },
  }),
  async (c) => {
    const profile = await profileService.updateSelf(principalOf(c), c.req.valid('json'))
    return c.json(ok(c, 'Profile updated successfully', profile), 200)
  },
)
```

- [ ] **Step 3: Mount in `server/app.ts`**

```ts
import { cleanerProfile } from './routes/cleaner-profile'
```

```ts
app.route('/api/v1/cleaner', cleanerProfile)
```

- [ ] **Step 4: Verify compile + lint + tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/cleaner-profile-service.ts server/routes/cleaner-profile.ts server/app.ts
git commit -m "feat(cleaner-profile): self profile read + update"
```

---

## Phase 7 — Hybrid aliases

### Task 17: Auth path aliases + booking create alias + extras normalization + reviews query extension

**Files:**
- Modify: `server/routes/customers.ts`, `server/routes/bookings.ts`, `server/schemas/review.ts`, `server/services/review-service.ts`, `server/routes/reviews.ts`

- [ ] **Step 1: Customer `/sign-in` + `/sign-up` aliases** — in `server/routes/customers.ts`

Refactor so both paths share one handler. Replace the single `signupRoute`/handler registration with a small loop. Add this after the existing `loginRoute` handler block:

```ts
// Hybrid path aliases for the apps' guessed contract (spec §5.3).
const signupAliasRoute = createRoute({
  method: 'post',
  path: '/sign-up',
  tags: ['Customers'],
  request: { body: { content: { 'application/json': { schema: CustomerSignupRequest } } } },
  responses: {
    201: { description: 'Account created', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
    409: { description: 'Email already exists', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})
customers.openapi(signupAliasRoute, async (c) => {
  const payload = c.req.valid('json')
  const r = await customerService.signup(payload, deviceFrom(c))
  return c.json(
    ok(c, 'Account created successfully', {
      customer: r.customer,
      tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language },
    }),
    201,
  )
})

const loginAliasRoute = createRoute({
  method: 'post',
  path: '/sign-in',
  tags: ['Customers'],
  request: { body: { content: { 'application/json': { schema: CustomerLogin } } } },
  responses: {
    200: { description: 'Login successful', content: { 'application/json': { schema: envelopeOf(AuthResultData) } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: ErrorEnvelope } } },
    ...commonErrors,
  },
})
customers.openapi(loginAliasRoute, async (c) => {
  const payload = c.req.valid('json')
  const r = await customerService.login(payload, deviceFrom(c))
  return c.json(
    ok(c, 'Login successful', {
      customer: r.customer,
      tokens: { accessToken: r.accessToken, refreshToken: r.refreshToken, tokenType: 'Bearer' as const, expiresIn: r.expiresIn, language: r.language },
    }),
    200,
  )
})
```

- [ ] **Step 2: Booking `extras`→`addons` normalization** — in `server/routes/bookings.ts`

Update the import from the booking schema to include `resolveAddons`:

```ts
import {
  BookingCustomerCreateRequest,
  resolveAddons,
  BookingListQuery,
  normalizeBookingListQuery,
  BookingListOut,
  BookingMarkPaidRequest,
  BookingRatingRequest,
  BookingOut,
  type BookingDoc,
} from '@/server/schemas/booking'
```

In the create handler, change the `addons` assignment in the `doc` object from `addons: payload.addons,` to:

```ts
    addons: resolveAddons(payload),
```

- [ ] **Step 3: Booking `POST /create` alias** — in `server/routes/bookings.ts`

Add a guard line next to the existing `bookings.use('/', ...)`:

```ts
bookings.use('/create', requireCustomerOrCleaner())
```

Add this alias registration immediately after the existing `bookings.openapi(createRouteDef, ...)` handler:

```ts
// POST /create — hybrid alias of POST / (same handler) for the app's guessed path.
const createAliasDef = createRoute({
  method: 'post',
  path: '/create',
  tags: ['Bookings'],
  security: [{ bearerAuth: [] }],
  request: { body: { content: { 'application/json': { schema: BookingCustomerCreateRequest } } } },
  responses: {
    201: { description: 'Booking created', content: { 'application/json': { schema: envelopeOf(BookingOut) } } },
    ...commonErrors,
  },
})
bookings.openapi(createAliasDef, async (c) => {
  const principal = principalOf(c)
  if (principal.role !== 'customer') throw new AppError(403, 'AUTH_ROLE_MISMATCH', 'Role not permitted', { required: 'customer', actual: principal.role })
  const payload = c.req.valid('json')
  const ts = nowEpoch()
  const { price, currency } = computePrice(payload)
  const doc: BookingDoc = {
    customer_id: principal.userId,
    cleaner_id: payload.cleanerId ?? null,
    serviceId: payload.serviceId,
    place_id: payload.placeId,
    status: 'PENDING',
    schedule: payload.schedule,
    addons: resolveAddons(payload),
    notes: payload.notes ?? null,
    price,
    currency,
    payment_id: null,
    payment_status: 'UNPAID',
    rating: null,
    acceptedAt: null,
    completedAt: null,
    acknowledgedAt: null,
    dateCreated: ts,
    lastUpdated: ts,
  }
  const created = await bookingRepo.createBooking(doc)
  return c.json(ok(c, 'Booking created successfully', created), 201)
})
```

> The `/create` static path is registered alongside `/` and the `/:booking_id` routes. Hono prioritizes static segments over params, so `POST /create` resolves here, not to a booking id. Verified by the smoke test in Step 6.

- [ ] **Step 4: Extend `ReviewListQuery`** — replace the `ReviewListQuery` block in `server/schemas/review.ts`

```ts
/** List filter: by cleaner, star rating, and time period (hybrid extension). */
export const ReviewListQuery = z
  .object({
    cleaner_id: z.string().optional().openapi({ example: '665f1b2c9a1e4b0012abcd34' }),
    stars: z.coerce.number().int().min(1).max(5).optional(),
    timePeriod: z.enum(['all', 'last30Days', 'last90Days', 'lastYear']).default('all'),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .openapi('ReviewListQuery')
export type ReviewListQuery = z.infer<typeof ReviewListQuery>
```

- [ ] **Step 5: Apply filters in `review-service`** — replace `listReviews` in `server/services/review-service.ts`

```ts
import { timePeriodToSince } from '@/server/schemas/cleaner-directory'
// ...existing imports stay...

/** List reviews with optional cleaner / stars / time-period filters (hybrid). */
export async function listReviews(filter: {
  cleaner_id?: string
  stars?: number
  timePeriod?: 'all' | 'last30Days' | 'last90Days' | 'lastYear'
  pageSize?: number
} = {}): Promise<ReviewOut[]> {
  let items = await reviewRepo.list({ cleaner_id: filter.cleaner_id })
  if (filter.stars) items = items.filter((r) => r.rating === filter.stars)
  if (filter.timePeriod && filter.timePeriod !== 'all') {
    const since = timePeriodToSince(filter.timePeriod, Math.floor(Date.now() / 1000))
    if (since !== undefined) items = items.filter((r) => (r.dateCreated ?? 0) >= since)
  }
  if (filter.pageSize) items = items.slice(0, filter.pageSize)
  return items
}
```

> Confirm `review-service.ts` imports `ReviewOut` type and `reviewRepo`; the existing file already does. Keep the other exported functions unchanged.

- [ ] **Step 6: Pass the new query params in the reviews route** — in `server/routes/reviews.ts`, update the `GET /` handler body:

```ts
  async (c) => {
    const { cleaner_id, stars, timePeriod, pageSize } = c.req.valid('query')
    const items = await reviewService.listReviews({ cleaner_id, stars, timePeriod, pageSize })
    return c.json(ok(c, 'Reviews fetched successfully', items), 200)
  },
```

- [ ] **Step 7: Verify compile + lint + tests + smoke**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 0 errors; all pass.

Smoke (static-vs-param priority for `/create`):
Run: `npx tsx -e "import('./server/app').then(async ({app}) => { const r = await app.request('/api/v1/bookings/create', {method:'POST'}); console.log('status', r.status) })"`
Expected: `401` (guard fires) — not `404`.

- [ ] **Step 8: Commit**

```bash
git add server/routes/customers.ts server/routes/bookings.ts server/schemas/review.ts server/services/review-service.ts server/routes/reviews.ts
git commit -m "feat(hybrid): auth path aliases, booking /create + extras, reviews filters"
```

---

## Phase 8 — Full verification & docs

### Task 18: Full gate + OpenAPI + endpoint smoke + status doc

**Files:**
- Modify: `app/MIGRATION_STATUS.md` (mark resolved TODOs), `backend-requirements/README.md` (optional: note resolution)

- [ ] **Step 1: Full verification gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck 0 errors; lint 0 errors (pre-existing cosmetic warnings OK); all tests pass.

- [ ] **Step 2: OpenAPI builds + new paths present**

Run: `npx tsx -e "import('./server/app').then(async ({app}) => { const r = await app.request('/api/doc'); const j = await r.json(); const p = Object.keys(j.paths); console.log(p.filter(x => /home|cleaner|services|read-all|password-reset|sign-in|sign-up|create/.test(x)).sort().join('\n')) })"`
Expected output includes:
```
/api/v1/bookings/cleaners
/api/v1/bookings/cleaners/{cleanerId}
/api/v1/bookings/cleaners/{cleanerId}/reviews
/api/v1/bookings/create
/api/v1/bookings/services/{serviceId}/extras
/api/v1/cleaner/jobs
/api/v1/cleaner/jobs/{jobId}
/api/v1/cleaner/jobs/{jobId}/accept
/api/v1/cleaner/jobs/{jobId}/decline
/api/v1/cleaner/profile
/api/v1/customers/password-reset/confirm
/api/v1/customers/password-reset/request
/api/v1/customers/sign-in
/api/v1/customers/sign-up
/api/v1/home
/api/v1/notifications/read-all
/api/v1/services
```

- [ ] **Step 3: Update `app/MIGRATION_STATUS.md`**

Under "Known stubs / TODOs", replace the line:
`- **Customer `/home` and `/bookings/*` contract aliases**, `/profile/payment-methods` aliases: TODO (cross-domain).`
with:
```
- **Customer `/home`, public `/bookings/cleaners*` + `/services/*/extras`, cleaner
  `/cleaner/jobs*` + `/cleaner/profile`, password-reset, notifications `read-all`,
  and the `/sign-in`/`/sign-up`/`/bookings/create` hybrid aliases**: IMPLEMENTED
  (see docs/superpowers/plans/2026-06-11-mobile-backend-endpoints.md). Enrichment
  fields (hourlyRate, certifications, yearsExperience, avatar, distanceMiles,
  availableDays) and booking `price` remain stubbed pending the cleaner-model
  extension + pricing-service.
- **`/profile/payment-methods` aliases**: still TODO.
```

- [ ] **Step 4: Commit**

```bash
git add app/MIGRATION_STATUS.md
git commit -m "docs: record mobile-facing endpoints as implemented"
```

- [ ] **Step 5 (manual, pre-cutover — NOT a code step): live-Mongo verification**

This repo has no live-Mongo test harness (spec §9). Before the apps cut over, run the backend against a real MongoDB (env per `docs/migration/11-infra-and-env.md`) and exercise, with a seeded customer + approved cleaner + a few bookings/reviews:
- `GET /api/v1/home` returns a populated `HomePageModel`.
- `GET /api/v1/bookings/cleaners` and `/cleaners/{id}` show derived rating/jobsDone.
- `GET /api/v1/bookings/cleaners/{id}/reviews?pageSize=2` paginates (nextCursor advances).
- `GET /api/v1/bookings/services/{serviceId}/extras` returns add-ons.
- `POST /api/v1/customers/password-reset/request` returns 200 for both known + unknown emails; `confirm` with the emailed token resets the password.
- `GET /api/v1/cleaner/jobs` (cleaner token) shows the pool; accept then decline behave per spec §8.
- `GET/PATCH /api/v1/cleaner/profile` round-trips `fullName`/`bio`/`services`.
- `POST /api/v1/notifications/read-all` flips all to read.

---

## Self-Review (completed by plan author)

**Spec coverage** — every spec §5 row maps to a task:
- 1a/1b password reset → Tasks 12–13. 2 home → Tasks 4, 10. 3a/3b catalog+extras → Tasks 1, 7, 9.
- 4 cleaner browse → Tasks 2, 6, 8, 9. 5 public profile → Tasks 2, 8, 9. 6 cleaner reviews → Tasks 2, 6, 8, 9.
- 7a/7b notifications → Tasks 6, 11. 8–10 cleaner jobs → Tasks 3, 6, 14, 15. 11 cleaner profile → Tasks 3, 6, 16.
- Hybrid aliases (§5.3) → Tasks 5, 17. Mounts/OpenAPI → distributed + Task 18.

**Type consistency** — schema/type names are identical across tasks (`CleanerCardOut`, `CleanerJobOut`, `mapBookingToCleanerJob`, `resolveAddons`, `aggregateForCleaner`, `listForCleanerPaginated`, `getCleanerJobFeed`, `markAllRead`, `listApproved`, `updatePassword`). Repo signatures used by services match their definitions in Task 6/12.

**Placeholder scan** — no TBD/TODO; every code step contains complete code; stubbed values are explicit, intentional, and flagged.

**Known risk flagged in-plan** — the `/api/v1/bookings` static-vs-param route priority (discovery `cleaners`/`services` + `/create` vs `/{booking_id}`) is covered by mount ordering + smoke tests (Tasks 9, 17, 18).
