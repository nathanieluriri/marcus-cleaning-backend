from scripts.backfill_cleaner_onboarding_status import _build_query


def test_backfill_query_matches_missing_or_null_status():
    query = _build_query()
    assert "$or" in query
    assert {"onboarding_status": {"$exists": False}} in query["$or"]
    assert {"onboarding_status": None} in query["$or"]
