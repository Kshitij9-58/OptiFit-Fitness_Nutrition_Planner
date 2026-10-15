"""
Retrieval evaluation for OptiFit.

Measures retrieval in isolation, with no LLM in the loop for the core metrics.
When a RAG system gives a bad answer, retrieval is usually the cause, and no
amount of prompt tuning fixes a document that was never retrieved.

Metrics
  recall@k   did at least one relevant doc land in the top k
  MRR        1 / rank of the first relevant doc, averaged over queries
  abstain    on queries labelled as out-of-scope, did the retriever return
             nothing instead of surfacing a spurious row

Usage
  python eval_retrieval.py --make-template     # write a starter gold file
  python eval_retrieval.py                     # run the eval
  python eval_retrieval.py --configs lexical hybrid hybrid+rerank
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

try:
    from .retrieval import Retriever, load_documents, tokenize
except ImportError:  # running as a script rather than a package module
    from retrieval import Retriever, load_documents, tokenize  # type: ignore

HERE = Path(__file__).resolve().parent
GOLD_PATH = HERE / "eval" / "retrieval_gold.json"

K_VALUES = (1, 3, 5)


# --------------------------------------------------------------------------
# Gold set
# --------------------------------------------------------------------------


def make_template(n: int = 15, seed: int = 0) -> None:
    """Write a starter gold file: one query stub per sampled row, plus a few
    out-of-scope queries. The stubs MUST be rewritten by hand into questions a
    real user would type. A gold set auto-derived from row text only measures
    whether the retriever can match a row against itself."""
    docs = load_documents()
    if not docs:
        print("No documents loaded; cannot build a template.")
        return

    random.seed(seed)
    sample = random.sample(docs, min(n, len(docs)))

    entries = [
        {
            "query": f"TODO rewrite as a natural question about: {d.text[:90]}",
            "relevant_doc_ids": [d.doc_id],
            "note": "paraphrase it; do not reuse the row's own wording",
        }
        for d in sample
    ]
    entries += [
        {"query": "what is the capital of France", "relevant_doc_ids": []},
        {"query": "write me a python script to sort a list", "relevant_doc_ids": []},
        {"query": "who won the world cup in 2018", "relevant_doc_ids": []},
    ]

    GOLD_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLD_PATH.write_text(json.dumps(entries, indent=2))
    print(f"Wrote {len(entries)} entries to {GOLD_PATH}")
    print("Now rewrite each TODO query by hand. Use vocabulary a user would use,")
    print("not the dataset's own wording, or you will measure nothing useful.")


def load_gold(path: Path = GOLD_PATH) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"No gold set at {path}. Run with --make-template first.")
    entries = json.loads(path.read_text())
    unwritten = [e for e in entries if e["query"].startswith("TODO")]
    if unwritten:
        print(f"WARNING: {len(unwritten)} query stub(s) still say TODO. "
              f"Results will be optimistic until those are rewritten.")
    return entries


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------


def build(config: str, docs) -> Retriever:
    return {
        "lexical": lambda: Retriever(docs, use_dense=False, use_rerank=False),
        "dense": lambda: Retriever(docs, use_dense=True, use_lexical=False,
                                   use_rerank=False),
        "hybrid": lambda: Retriever(docs, use_dense=True, use_rerank=False),
        "hybrid+rerank": lambda: Retriever(docs, use_dense=True, use_rerank=True),
    }[config]()


def evaluate(retriever: Retriever, gold: list[dict], max_k: int = 10) -> dict:
    positives = [g for g in gold if g.get("relevant_doc_ids")]
    negatives = [g for g in gold if not g.get("relevant_doc_ids")]

    recall = {k: 0 for k in K_VALUES}
    reciprocal_ranks: list[float] = []

    for entry in positives:
        relevant = set(entry["relevant_doc_ids"])
        retrieved = [r.doc.doc_id for r in retriever.search(entry["query"], top_k=max_k)]

        for k in K_VALUES:
            if relevant & set(retrieved[:k]):
                recall[k] += 1

        rr = 0.0
        for rank, doc_id in enumerate(retrieved, start=1):
            if doc_id in relevant:
                rr = 1.0 / rank
                break
        reciprocal_ranks.append(rr)

    correct_abstains = sum(
        1 for entry in negatives if not retriever.search(entry["query"], top_k=max_k)
    )

    n_pos = len(positives) or 1
    return {
        "mode": retriever.mode,
        "n_positive": len(positives),
        "n_negative": len(negatives),
        **{f"recall@{k}": recall[k] / n_pos for k in K_VALUES},
        "mrr": sum(reciprocal_ranks) / n_pos,
        "abstain_rate": (correct_abstains / len(negatives)) if negatives else None,
    }


def print_table(rows: list[tuple[str, dict]]) -> None:
    headers = ["config", "mode", *[f"recall@{k}" for k in K_VALUES],
               "MRR", "abstain"]
    widths = [16, 18] + [10] * len(K_VALUES) + [8, 9]
    print()
    print("".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("-" * sum(widths))
    for name, m in rows:
        abstain = "n/a" if m["abstain_rate"] is None else f"{m['abstain_rate']:.0%}"
        cells = [
            name, m["mode"],
            *[f"{m[f'recall@{k}']:.0%}" for k in K_VALUES],
            f"{m['mrr']:.3f}", abstain,
        ]
        print("".join(str(c).ljust(w) for c, w in zip(cells, widths)))
    print()
    if rows:
        print(f"{rows[0][1]['n_positive']} in-scope queries, "
              f"{rows[0][1]['n_negative']} out-of-scope queries.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--make-template", action="store_true")
    parser.add_argument("--configs", nargs="+",
                        default=["lexical", "dense", "hybrid"],
                        choices=["lexical", "dense", "hybrid", "hybrid+rerank"])
    args = parser.parse_args()

    if args.make_template:
        make_template()
        return

    gold = load_gold()
    docs = load_documents()
    if not docs:
        raise SystemExit("No documents loaded; nothing to evaluate.")

    rows = []
    for config in args.configs:
        print(f"Running {config}...")
        rows.append((config, evaluate(build(config, docs), gold)))
    print_table(rows)


if __name__ == "__main__":
    main()
