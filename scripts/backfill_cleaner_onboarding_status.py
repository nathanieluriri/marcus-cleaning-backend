from __future__ import annotations

import argparse
import asyncio
import os
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient


def _build_query() -> dict[str, Any]:
    return {
        "$or": [
            {"onboarding_status": {"$exists": False}},
            {"onboarding_status": None},
        ]
    }


async def _run(*, apply_changes: bool, sample_size: int) -> int:
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME")
    if not db_name:
        raise RuntimeError("DB_NAME is required")

    client = AsyncIOMotorClient(mongo_url)
    try:
        cleaners = client[db_name].cleaners
        query = _build_query()
        matched_count = await cleaners.count_documents(query)

        sample_ids: list[str] = []
        cursor = cleaners.find(query, {"_id": 1}).limit(max(sample_size, 0))
        async for row in cursor:
            sample_ids.append(str(row.get("_id")))

        print(f"mode={'apply' if apply_changes else 'dry-run'}")
        print(f"matched_count={matched_count}")
        print(f"sample_ids={sample_ids}")

        if not apply_changes:
            print("modified_count=0")
            return 0

        update_payload = {
            "$set": {
                "onboarding_status": "PENDING",
            }
        }
        result = await cleaners.update_many(query, update_payload)
        print(f"modified_count={result.modified_count}")
        return int(result.modified_count)
    finally:
        client.close()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill missing cleaner onboarding_status to PENDING."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply migration updates. Omit for dry-run mode.",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=10,
        help="Number of example ids to print.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    modified_count = asyncio.run(_run(apply_changes=args.apply, sample_size=args.sample_size))
    if args.apply:
        print(f"done: modified_count={modified_count}")
    else:
        print("done: dry-run")


if __name__ == "__main__":
    main()
