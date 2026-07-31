# Go-Live Checklist — manual steps only Marcus can do

Everything in code is merged. This file lists the work that needs a human:
console access, secrets, app-store tooling, and a few product decisions.

Repos and their current state (all merged, all suites green):

| Repo | Branch | Head |
| --- | --- | --- |
| `Marcus-cleaning-backend` | `master` | list-admins merge |
| `Marcus-cleaning-admin-frontend` | `master` | admin platform merge |
| `cleaning_app` (Flutter) | `main` | push/FCM merge |

---

## 1. Push the three repos

Nothing is published yet — every commit is local. Pushing `master` on the
backend is what triggers the Vercel deploy, so do the env vars in §2 **first**.

Backend — normal push (its history was never rewritten):

```bash
git -C "C:\Users\Mr Dashi\Downloads\Marcus-cleaning-backend" push origin master
```

Admin frontend — normal push (`origin/master`'s tip is untouched, so this
fast-forwards):

```bash
git -C "C:\Users\Mr Dashi\Downloads\Marcus-cleaning-admin-frontend" push origin master
```

Flutter — **force required.** Commit messages were rewritten to strip AI
co-author trailers, and 12 of those commits had already been pushed, so their
hashes changed. File contents are byte-identical (verified by comparing tree
hashes before and after). If anyone else has a clone of this repo, they must
re-clone or hard-reset after this push.

```bash
git -C "C:\flutter_projects\cleaning_app" push --force-with-lease origin main
```

Note: `git fetch` on the Flutter remote failed from here with "Repository not
found" — check that `https://github.com/nathanieluriri/cleaning_app.git` is the
right URL and that you're authenticated before pushing.

---

## 2. Backend environment variables (Vercel → Settings → Environment Variables)

### Required before the admin console works

| Key | Value | Why |
| --- | --- | --- |
| `RESEND_API_KEY` | your Resend key | login OTP codes + admin invite emails |
| `RESEND_FROM_EMAIL` | e.g. `Marcus Cleaning <no-reply@yourdomain>` | sender for those emails. **Preferred name.** `EMAIL_FROM` is still accepted as a fallback — set either one, and if both are set `RESEND_FROM_EMAIL` wins. The address must be on a domain you have verified in Resend, or every send fails. |
| `SUPER_ADMIN_EMAIL` | your admin email | bootstraps the first super admin on first login |
| `SUPER_ADMIN_PASSWORD` | a strong password | same; used once, then change it in-app |
| `CORS_ORIGINS` | the admin site origin, comma-separated | e.g. `https://admin.yourdomain.com` |

### Must stay UNSET in production

| Key | Why |
| --- | --- |
| `OTP_DEV_CODE` | a fixed bypass code. **The server refuses to boot in production if it is set** — that guard is deliberate. |
| `ADMIN_COOKIE_DOMAIN` | the admin console reaches the API through a same-origin Next rewrite. Setting a cookie domain breaks that. |

### Optional / feature-gated

| Key | Value | Effect |
| --- | --- | --- |
| `ADMIN_OTP_REQUIRED` | leave unset (defaults `true`) | Set `false` **only** if you deploy the backend before the new admin frontend — the old UI can't handle the OTP step. |
| `ADMIN_LOGIN_URL` | `https://admin.yourdomain.com/admin/login` | link inside invite emails |
| `FIREBASE_PROJECT_ID` | `marcus-cleaning` | verifies Google sign-in tokens from the mobile apps |
| `FCM_PROJECT_ID` | `marcus-cleaning` | push |
| `FCM_CLIENT_EMAIL` | from the service-account JSON | push |
| `FCM_PRIVATE_KEY` | whole key incl. `-----BEGIN PRIVATE KEY-----` | push |
| `STRIPE_PUBLISHABLE_KEY` | your pk_… | only surfaces via `GET /v1/payments/config`; card entry is not built yet |

Get the three `FCM_*` values from Firebase console → Project settings →
Service accounts → **Generate new private key**. That JSON is a credential:
copy the three fields into Vercel and delete the download. Do not commit it,
and do not install `firebase-admin` — the backend signs its own FCM v1 JWTs.

---

## 3. Admin frontend environment

| Key | Value |
| --- | --- |
| `API_ORIGIN` | `https://marcus-cleaning-backend.vercel.app` (or your API domain) |

`NEXT_PUBLIC_API_BASE_URL` is **retired** — delete it from Vercel and from your
local `.env.local`. Your `.env.local` currently still has the old key and no
`API_ORIGIN`, which means local `npm run dev` silently signs in against
production. Fix that file before developing locally.

Why this matters: the browser calls `/api/...` on the admin site's own origin
and Next proxies to the backend. That is what makes the `SameSite=Lax` session
cookies first-party. If you ever host the API on a different domain without the
proxy, admin login will stop working. This is written up in
`Marcus-cleaning-admin-frontend/docs/ADMIN_FRONTEND_AUTH.md`.

---

## 4. Firebase console — mobile apps

Full steps in `cleaning_app/docs/FIREBASE_SETUP.md`. Summary:

1. Project **marcus-cleaning** → add 4 apps: Android + iOS for the customer app
   and for the staff app (application IDs are in each app's `build.gradle.kts`).
2. Android: add debug **and** release SHA-1 + SHA-256 for each app
   (`cd android && ./gradlew signingReport`). Google Sign-In fails silently
   without these.
3. Download and place: `google-services.json` → `apps/<app>/android/app/`,
   `GoogleService-Info.plist` → `apps/<app>/ios/Runner/`.
4. Authentication → Sign-in method → enable **Google**.
5. `dart pub global activate flutterfire_cli`, then in each app dir:
   `flutterfire configure --project=marcus-cleaning`.
6. iOS URL scheme: add the plist's `REVERSED_CLIENT_ID` to `Info.plist`.

Until these files exist the apps still run — Google Sign-In and push just stay
disabled, by design.

### iOS push (Xcode, needs a Mac)

Full steps in `cleaning_app/docs/PUSH_NOTIFICATIONS_SETUP.md`.

1. Xcode → Signing & Capabilities → add **Push Notifications** and
   **Background Modes → Remote notifications** for both apps.
2. Apple Developer → create an **APNs auth key** (.p8) → upload it in Firebase
   console → Project settings → Cloud Messaging.

Without step 1 iOS registers a token and then receives nothing, silently.

---

## 5. First admin login (after deploy)

1. Go to `https://<admin-site>/admin/login`.
2. Sign in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` — this creates the
   super admin on first use.
3. A 6-digit code is emailed. Enter it.
4. Change the bootstrap password (Settings → Security).
5. Enrol TOTP (Settings → Security → Two-factor). **Save the 8 backup codes** —
   they're shown once and they're the only way back in if you lose the
   authenticator. There is currently no admin-resets-another-admin's-2FA
   endpoint; recovery is delete + re-invite.
6. Invite the rest of the team (Team → Invite admin) and give each an access
   preset. They get a temp password that expires in 72 hours.

---

## 6. Decisions I need from you

1. **Production payouts are not safe to enable yet.** The staff payout step
   sends a placeholder `accountToken` derived from the raw account number
   because no tokenization provider is wired. Pick a provider (Stripe Connect
   or Flutterwave) before any real payout runs.
2. **Payments are on the `test` provider.** Bookings settle instantly and no
   money moves. Real card entry needs a provider decision plus
   `STRIPE_PUBLISHABLE_KEY`; hosted-checkout is the other option and works
   without in-app card fields.
3. **Access presets are narrow by design.** Only `all_controls` can manage
   admins or see the team list. Some presets look thin because the matching
   backend write endpoints (FAQ, promotions, support-ticket edit) don't exist
   yet — tell me if a preset should cover something it currently doesn't.
4. **Brand green was darkened in the admin console's light mode** (white text
   on the old green was 2.30:1, failing accessibility; it's now 4.77:1). Dark
   mode is unchanged. Take a look and tell me if you want a different green.
5. **Promo push sound on iOS.** Promo notifications are deliberately silent on
   Android but will play the brand sound on iOS. Say the word and I'll have the
   backend send the default sound for promos instead.
6. **Document upload sends placeholder bytes** — the staff application flow
   needs a real file picker (`file_picker` dependency) before cleaners can
   actually upload IDs. Small job; I left it out to avoid adding a dependency
   unasked.

---

## 7. Worth knowing

- The customer app's fake login is gone — Google/Apple/"Forgot password" no
  longer log people in without authentication. Apple Sign-In is hidden until
  you have an Apple Developer setup.
- Staff can't reach the jobs dashboard until an admin approves them; the gate
  fails closed on anything unrecognised.
- Every admin route is permission-checked, and a build-breaking test stops
  anyone from adding an admin route without cataloguing it.
- `git push` is the only thing standing between this and a live deploy.
