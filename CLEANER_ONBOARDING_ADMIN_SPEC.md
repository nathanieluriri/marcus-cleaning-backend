# Cleaner Onboarding Admin Spec

This document defines how cleaner onboarding should work for the admin dashboard, with explicit review duties, required data, documents, and API usage.

## 1. Short Answer

Yes. Admins should see full cleaner onboarding details and supporting documents before approving onboarding.
Approval without this review creates fraud, quality, and compliance risk.

## 2. Current Backend Reality (As Implemented)

Current admin decision endpoint:
- `PATCH /v1/admins/cleaners/{cleaner_id}/onboarding-review`

Request body:

```json
{
  "status": "APPROVED | REJECTED",
  "rejection_reason": "required when REJECTED"
}
```

Current backend validation:
- If `status=REJECTED`, `rejection_reason` is required.
- If `status=APPROVED`, backend currently checks only that `profile` exists.

Important current limitation:
- There is no dedicated admin endpoint that lists pending onboarding cleaners.
- There is no dedicated admin onboarding detail endpoint.
- The onboarding profile stores `government_id_image_url` as URL string (not document_id).

Implication for frontend:
- Admin can submit onboarding decision by cleaner id.
- But full review UX requires backend support for queue/list/detail data retrieval.

## 3. Admin Duties in Cleaner Onboarding

Each admin reviewer must:

1. Confirm identity and profile completeness.
2. Inspect uploaded government ID image.
3. Check location and service radius reasonableness.
4. Check availability and service selections.
5. Confirm payout info format completeness.
6. Approve or reject with a clear reason.
7. Ensure rejection reasons are actionable for cleaner resubmission.

## 4. Data That Must Be Shown Before Approval

From cleaner record + onboarding profile:

- Cleaner identity:
  - `id`
  - `firstName`, `lastName`
  - `email`
  - `date_created`
  - `onboarding_status`
  - `rejection_reason` (if any previous rejection)

- Onboarding profile:
  - `profile.location.place_id`
  - `profile.location.place` (address/context payload)
  - `profile.location.service_radius_miles` (10-50)
  - `profile.weekly_availability.days[]`
  - `profile.experience_level`
  - `profile.services[]`
  - `profile.government_id_image_url`
  - `profile.payout_information.*`

- Decision metadata:
  - Previous review history (if available)
  - Current reviewer id
  - Decision timestamp

## 5. Document Review Requirements

Government ID (`government_id_image_url`) review checklist:

1. URL resolves and preview loads.
2. Name on ID aligns with account name pattern.
3. ID is readable and not clearly expired/invalid.
4. Image quality is sufficient (not cropped/blurred).
5. Document appears authentic (no obvious tampering).

If any failure occurs:
- Reject onboarding.
- Provide explicit `rejection_reason` (human-readable and specific).

## 6. Recommended Admin UI Flow

## 6.1 Queue Page

Show pending cleaners with:
- cleaner id
- full name
- email
- created date
- onboarding status
- quick flags (missing profile, missing document URL)

Filters:
- `PENDING`, `REJECTED`, `APPROVED`
- date range
- search by name/email/id

## 6.2 Detail Page

Panels:
1. Identity summary
2. Profile completeness checklist
3. Document preview (government ID)
4. Location + service radius
5. Availability matrix
6. Services + experience
7. Payout details
8. Decision actions (Approve / Reject)

Reject action must require reason input.

## 6.3 Decision Confirmation

Before final submit:
- show cleaner name/id
- show chosen status
- show rejection reason (if rejected)
- require confirm click

## 7. Decision API Usage (Current)

Endpoint:
- `PATCH /v1/admins/cleaners/{cleaner_id}/onboarding-review`

Approve payload:

```json
{
  "status": "APPROVED"
}
```

Reject payload:

```json
{
  "status": "REJECTED",
  "rejection_reason": "Government ID image is unreadable. Please upload a clearer photo."
}
```

Possible responses/errors:
- `200` success
- `401` invalid token
- `403` permission/account status issue
- `404` cleaner not found
- `422` validation failed (e.g., profile incomplete for approval)

## 8. Monitoring and Audit Expectations

Review actions are logged as admin monitoring events:
- `ADMIN_ONBOARDING_REVIEW_ACTION`

Additional alert behavior:
- Rejection without reason is flagged as warning alert path in monitoring service.

Admin dashboard should show:
- total reviewed today
- approvals today
- rejections today
- average review time (if latency is wired)
- reviewer-level throughput

## 9. Required Permissions for Admin Reviewer

Admin account must include permission for onboarding review route key:
- `PATCH:/admins/cleaners/{cleaner_id}/onboarding-review`

If missing, backend returns permission denied (`403 AUTH_PERMISSION_DENIED`).

## 10. Gap List (Needed for Full Production Workflow)

To make onboarding review complete for frontend and operations, backend should add:

1. `GET /v1/admins/cleaners/onboarding`
- list onboarding candidates with filters (`status`, `start`, `stop`, search)

2. `GET /v1/admins/cleaners/{cleaner_id}/onboarding`
- full onboarding review payload optimized for admin decision UI

3. Optional richer document model
- store document ids + verification status, not only a raw URL string

4. Explicit review history endpoint
- who reviewed, when, decision, reason changes

## 11. Frontend Validation Rules

Before allowing `APPROVED` submit, frontend should enforce:

1. `profile` exists.
2. `government_id_image_url` exists and preview succeeds.
3. location, availability, services, payout fields are present.
4. reviewer has explicitly confirmed checklist completion.

Before allowing `REJECTED` submit:

1. `rejection_reason` non-empty.
2. reason length >= 10 chars.
3. reason message actionable.

## 12. Suggested Status UX Copy

- `PENDING`: "Awaiting admin review"
- `APPROVED`: "Cleaner approved for marketplace visibility"
- `REJECTED`: "Cleaner must update onboarding details and resubmit"

## 13. Minimal QA Scenarios

1. Approve cleaner with complete profile => success.
2. Approve cleaner with missing profile => blocked with `422`.
3. Reject cleaner without reason => blocked by backend validation.
4. Admin without onboarding permission attempts review => `403`.
5. Invalid cleaner id => proper error handling.

---

This spec should be used by frontend, backend, and operations together so onboarding decisions are traceable, consistent, and safe.
