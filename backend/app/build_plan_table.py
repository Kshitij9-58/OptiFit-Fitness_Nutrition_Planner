"""
Collapse the fitness CSV into a small JSON lookup table.

Run once, offline, whenever the source CSV changes. The 16 MB file never needs
to ship or be parsed at boot: the dataset holds only a handful of distinct
plans repeated tens of thousands of times.

    python tools/build_plan_table.py --csv app/fitness_dataset.csv --out app/plan_table.json

Also reports which columns actually determine the output. If a column turns out
to be decorative, the plan ignores it, and that is worth knowing before the plan
is presented to a user as personalised.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from itertools import combinations
from pathlib import Path

KEY_COLUMNS = ["Gender", "Goal", "BMI Category"]
VALUE_COLUMNS = ["Exercise Schedule", "Meal Plan"]


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        return [
            {k.strip(): (v or "").strip() for k, v in row.items() if k}
            for row in csv.DictReader(f)
        ]


def check_determinism(rows: list[dict], key_cols: list[str]) -> tuple[bool, dict]:
    """Does key_cols determine every value column? Returns (ok, mapping)."""
    seen: dict[tuple, dict[str, set[str]]] = defaultdict(
        lambda: {c: set() for c in VALUE_COLUMNS}
    )
    for row in rows:
        key = tuple(row[c] for c in key_cols)
        for col in VALUE_COLUMNS:
            seen[key][col].add(row[col])

    conflicts = {
        key: {c: sorted(v) for c, v in vals.items() if len(v) > 1}
        for key, vals in seen.items()
        if any(len(v) > 1 for v in vals.values())
    }
    mapping = {
        key: {c: next(iter(v)) for c, v in vals.items()}
        for key, vals in seen.items()
    }
    return (not conflicts, {"mapping": mapping, "conflicts": conflicts})


def minimal_keys(rows: list[dict]) -> list[list[str]]:
    """Smallest column subsets that still determine the output."""
    for size in range(1, len(KEY_COLUMNS) + 1):
        found = [
            list(combo)
            for combo in combinations(KEY_COLUMNS, size)
            if check_determinism(rows, list(combo))[0]
        ]
        if found:
            return found
    return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    rows = load_rows(args.csv)
    print(f"Read {len(rows):,} rows from {args.csv}")

    ok, result = check_determinism(rows, KEY_COLUMNS)
    if not ok:
        print("\nERROR: the same key maps to more than one plan:")
        for key, cols in list(result["conflicts"].items())[:5]:
            print(f"  {key}: {cols}")
        raise SystemExit("Resolve the conflicts before building the table.")

    mapping = result["mapping"]
    print(f"{len(mapping)} distinct key combinations, all deterministic.")

    for col in VALUE_COLUMNS:
        uniq = {v[col] for v in mapping.values()}
        print(f"  {col}: {len(uniq)} distinct value(s)")

    # --- which columns actually matter -----------------------------------
    minimal = minimal_keys(rows)
    print("\nMinimal determining key(s):")
    for combo in minimal:
        print(f"  {' + '.join(combo)}")
    decorative = [c for c in KEY_COLUMNS
                  if minimal and all(c not in combo for combo in minimal)]
    if decorative:
        print(f"\n  NOTE: {', '.join(decorative)} does not affect the output.")
        print("  The plan is identical regardless of its value. Do not present")
        print("  it to the user as a factor in their personalised plan.")

    # --- write -------------------------------------------------------------
    table = {
        "_schema": {
            "key": "gender|goal|bmi_category, lowercased",
            "minimal_determining_keys": minimal,
            "source_rows": len(rows),
        },
        "plans": {
            "|".join(k).lower(): {
                "exercise_schedule": v["Exercise Schedule"],
                "meal_plan": v["Meal Plan"],
                "meal_plan_vegetarian": None,
            }
            for k, v in sorted(mapping.items())
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, indent=2), encoding="utf-8")

    size_in = args.csv.stat().st_size / 1_048_576
    size_out = args.out.stat().st_size / 1024
    print(f"\nWrote {args.out} ({size_out:.1f} KB, from {size_in:.1f} MB)")
    print("\nmeal_plan_vegetarian is null on every entry: the dataset has no")
    print("vegetarian dimension. Author those by hand, or drop diet_type from")
    print("the form rather than collecting a preference you cannot honour.")


if __name__ == "__main__":
    main()