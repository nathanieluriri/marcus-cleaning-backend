# 15 — Open Questions & Risks

Tracked items that need a decision, verification, or carry migration risk. Resolve before or during the relevant phase (`14`).

## Open questions (need a human decision)

| # | Question | Default if unanswered | Affects |
|---|----------|-----------------------|---------|
| Q1 | **Admin credential source** after dropping Auth0 — migrate admins to local passwords (password-set email) vs keep an Auth0→JWT bridge permanently? | Local passwords + temporary Auth0 bridge during cutover | `03`, `14` |
| Q2 | **URL prefix** — keep client URLs as `/v1/*` via rewrite, or move clients to `/api/v1/*`? | Keep `/v1/*` via rewrite (zero client change) | `07`, `14` |
| Q3 | **`/v1/notificationss`** double-"s" spelling — preserve verbatim or correct with redirect? | Preserve verbatim + add corrected alias | `07` |
| Q4 | **Vercel plan** — Hobby (cron once/day) vs Pro (per-minute cron, higher `maxDuration`)? | Pro (reconcile + lifecycle want sub-daily cron) | `10`, `11` |
| Q5 | **Audit export** approach — synchronous/streamed vs cron-backed job doc vs queue? | Synchronous/streamed; cron-backed if it exceeds time budget | `10` |
| Q6 | **Storage** — keep S3 or move to Vercel Blob? | Keep S3 (existing bucket/abstraction) | `11` |
| Q7 | **Email branding/sender** — current templates say "Aperture Security" / "EPS Booking Admin Portal"; what is the correct Marcus Cleaning sender name + from-domain? | Confirm with team before porting templates | `08` |
| Q8 | **Broadcast fan-out size** — how many recipients can a system broadcast target? Determines inline+batch vs queue. | Inline + Resend batch (≤100/chunk); queue if larger | `08`, `10` |
| Q9 | **OTP/MFA scope** — is OTP login a customer/cleaner flow, admin-only, or all? Drives which login paths issue OTP. | Verify against current `send_otp` usage | `03`, `08` |

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **Refresh-token rotation breaks clients** that cache and reuse a refresh token without replacing it. | Medium | High (logouts) | Audit each client's token-storage code before cutover; rotation requires store-the-new-token behavior. Optionally start with a generous reuse grace window. (`14`) |
| R2 | **Contract drift** — a Zod schema subtly differs from the Pydantic model (field name, optionality, camel/snake). | High | High | Golden-response + OpenAPI snapshot parity tests (`13`); explicit alias tests. |
| R3 | **Mongo connection exhaustion** under serverless concurrency. | Medium | High | Module-cached client + low `maxPoolSize`; Atlas tier with headroom; monitor connection count. (`02`, `11`) |
| R4 | **`@hono/zod-openapi` basePath bug** (#952) produces spec paths missing `/api`. | Medium | Low | `servers: [{ url: '/api' }]` workaround; re-verify against pinned version. (`05`) |
| R5 | **Cron unreliability** (missed/duplicate/overlapping runs; best-effort delivery, no retries). | Medium | Medium | Idempotent handlers; Upstash lock for the reconcile sweep; webhooks as primary truth. (`10`) |
| R6 | **`maxDuration` ceiling** too low for audit export or large aggregations. | Medium | Medium | Dedicated route segment with raised `maxDuration`; stream; or cron-backed/queue. (`01`, `10`) |
| R7 | **Auth0 admin cutover** locks out admins if the bridge/password-set flow is mistimed. | Low | High | Keep Auth0 bridge until local passwords confirmed; staged admin migration; rollback via DB-shared old backend. (`14`) |
| R8 | **Resend domain not verified** → 403 on real sends. | Low | High | Verify SPF/DKIM in Phase 0; test with real recipient before Phase 4. (`08`) |
| R9 | **Webhook signature handling** — parsing JSON before verifying breaks signatures (Stripe/Flutterwave/Resend). | Medium | High | Read raw body first; verify; then parse. Covered in `08`/`09`; enforce via tests (`13`). |
| R10 | **Python→TS behavioral gaps** in pricing/state-machine edge cases. | Medium | Medium | Port the corresponding `test_*` suites first (TDD-style) and run against golden data. (`13`) |
| R11 | **Local storage backend** assumptions (filesystem writes) don't hold on Vercel. | Low | Medium | Force `STORAGE_BACKEND=s3`/`blob` in prod; local is dev-only. (`11`) |

## Future hardening (explicitly out of scope now)

- **Asymmetric JWT (EdDSA/Ed25519) + JWKS** if tokens ever need third-party verification (`03`).
- **Access-token denylist** keyed by `sid` for instant revocation on sensitive paths (`03`).
- **DPoP / sender-constrained tokens** for the mobile apps (RFC 9700 alternative to rotation) (`03`).
- **Managed queue (Upstash QStash / Inngest)** for heavy/long jobs and large broadcast fan-out (`10`).
- **Vercel Blob** migration off S3 (`11`).
- **Multi-region** read locality if latency demands it.

## Verification checklist before implementation starts

- [ ] Confirm pinned versions: `hono`, `@hono/zod-openapi`, `@scalar/hono-api-reference`, `mongodb`, `jose`, `resend`, `@react-email/components`, `@upstash/ratelimit`, `@upstash/redis`, `zod`.
- [ ] Re-check the basePath/OpenAPI behavior (R4) against the pinned `@hono/zod-openapi`.
- [ ] Confirm Vercel plan + `maxDuration` ceiling (Q4, R6).
- [ ] Verify Resend domain (R8).
- [ ] Audit client token-refresh code for rotation compatibility (R1, `14`).
- [ ] Capture golden responses from the current API for parity tests (`13`).

## Cross-references

All files `00`–`14`. This document is the running ledger — update it as questions are answered and risks retired.
