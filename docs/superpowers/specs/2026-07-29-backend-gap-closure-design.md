# Backend Gap-Closure (Phase 2a) — Design Spec

Date: 2026-07-29. Status: approved. Repo: this backend (`app/`).
Purpose: close the backend gaps that block wiring the two Flutter apps to real
data (Phase 2b/2c) — per docs in the Flutter repo (`BACKEND_INTEGRATION_ROUND2.md`).

## Scope (six changes)

1. **Booking duration** — optional `hours` on `BookingQuoteRequest` and
   `BookingCustomerCreateRequest`. When present and the service is hourly
   (`hourlyRate` set), price = `hourlyRate * hours` (+ addons), with `hours`
   validated against the catalog's `minimumHours` / `maximumHours` /
   `hourIncrement`. Invalid hours → 422 `VALIDATION_FAILED`. Stored on the
   booking doc and exposed as `hours` on `BookingOut`. Omitted `hours` keeps
   today's flat `basePrice` behavior (fully backward compatible).
2. **Customer sessions** — `registerSessionRoutes(customers, requireCustomer(), 'Customers')`
   giving `POST /v1/customers/sessions/{logout|revoke-others|revoke-all}`.
3. **Favorites** — set of cleaner ids on the customer document
   (`favoriteCleanerIds`). Endpoints: `GET /v1/customers/me/favorites`
   (hydrated `CleanerCardOut[]`), `PUT /v1/customers/me/favorites/{cleaner_id}`,
   `DELETE /v1/customers/me/favorites/{cleaner_id}`. PUT/DELETE idempotent
   (`$addToSet`/`$pull`); PUT validates the cleaner exists (404 otherwise).
4. **Cleaner settings** — `GET /v1/cleaner/settings`,
   `PATCH /v1/cleaner/settings/notifications`, mirroring the customer settings
   shape (`{push, email, sms, marketing}` with the same defaults). Storage as
   dotted `settings.notifications.*` on the cleaner doc, so the existing
   `cleanerRepo.listMarketingOptOutIds` query works unchanged.
5. **Notification routing fixes** — (a) all sounds → `notification.caf`
   (fallback `default` entries stay `default`); (b) `chat.message` gets
   `cleanerRoute: '/chat/:conversationId'` (staff chat screen exists now);
   (c) `application.more_info_required` includes `missingStep` in its push data
   when the caller provides it (routing table passes it through via data — add
   `missingStep` to the entry's documented data keys and ensure
   `navigationFor` output retains it).
6. **Payments config** — public `GET /v1/payments/config` →
   `{defaultProvider, providers: ['test'|...], publishableKey: string|null}`.
   New optional env `STRIPE_PUBLISHABLE_KEY` surfaced when set; secrets never
   returned. Registered before `/{payment_id}` (route-ordering constraint).

## Non-goals

Casing warts, duplicate aliases, `CleanerJobOut` enrichment, cleaner→client
ratings, Stripe PaymentSheet flow, payout tokenization — all deferred with
documented app-side interims.

## Testing

Vitest, repo's established `vi.mock`-repo-factory pattern (no Mongo).
Each change lands with unit tests; `notification-routing.test.ts` extended for
sounds/chat-route; new `tests/{booking-hours,favorites,cleaner-settings}.test.ts`;
payments config asserted to never leak secret keys. Full suite green.

## Compatibility

All changes additive. Existing clients unaffected: `hours` optional, new
routes only, sound rename affects only iOS payload strings (Android sound is
channel-owned), `cleanerRoute` addition only adds a route where none resolved.
