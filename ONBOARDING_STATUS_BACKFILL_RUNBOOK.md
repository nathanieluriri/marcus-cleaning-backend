# Cleaner Onboarding Status Backfill Runbook

## Goal
Backfill legacy cleaner documents with missing/null `onboarding_status` to `PENDING`, then keep onboarding queue filter strict.

## Step 1: Dry Run
```bash
python scripts/backfill_cleaner_onboarding_status.py
```

Expected output includes:
- `mode=dry-run`
- `matched_count=<N>`
- `sample_ids=[...]`
- `modified_count=0`

## Step 2: Apply Backfill
```bash
python scripts/backfill_cleaner_onboarding_status.py --apply
```

Expected output includes:
- `mode=apply`
- `matched_count=<N>`
- `modified_count=<N or less>`

## Step 3: Verify Idempotency
Run apply again:
```bash
python scripts/backfill_cleaner_onboarding_status.py --apply
```

Expected:
- `matched_count=0`
- `modified_count=0`

## Step 4: Remove Legacy Fallback
After step 3 confirms zero remaining legacy rows, remove fallback in onboarding queue filter and keep strict:
- `onboarding_status == "PENDING"` only.
