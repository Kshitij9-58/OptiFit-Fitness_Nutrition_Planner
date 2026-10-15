"""
OptiFit retrieval layer.

Kept deliberately separate from generation so that retrieval quality can be
measured on its own (see eval_retrieval.py). When a RAG system gives a bad
answer the cause is usually retrieval, and that is only visible if the two
stages are evaluated independently.

Design:
  - Lexical:  BM25, pure Python, no third-party packages.
  - Semantic: dense embeddings via Ollama (no new Python dependency, since
              Ollama is already in the stack). Cached to disk by content hash.
  - Fusion:   Reciprocal Rank Fusion over the two ranked lists.
  - Rerank:   optional LLM grading pass over the fused top-k.
  - Abstain:  if nothing clears the relevance floor, callers are told so
              explicitly instead of being handed an irrelevant row.

Degrades gracefully: if the embedding model is unreachable, the retriever
falls back to lexical-only and records that in `self.mode`.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
DATASET_PATH = Path(os.getenv("OPTIFIT_DATASET", HERE / "fitness_dataset.csv"))
EMBED_CACHE_PATH = Path(os.getenv("OPTIFIT_EMBED_CACHE", HERE / ".embed_cache.json"))

EMBED_MODEL = os.getenv("OPTIFIT_EMBED_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("OPTIFIT_LLM_MODEL", "llama3")

DEFAULT_TOP_K = int(os.getenv("OPTIFIT_TOP_K", "4"))
CANDIDATE_POOL = int(os.getenv("OPTIFIT_CANDIDATE_POOL", "12"))
RRF_K = 60  # standard RRF damping constant

# Abstain thresholds. Tune these against the eval set, not by vibes.
MIN_COSINE = float(os.getenv("OPTIFIT_MIN_COSINE", "0.45"))
MIN_LEXICAL_OVERLAP = int(os.getenv("OPTIFIT_MIN_LEXICAL_OVERLAP", "1"))

STOPWORDS = {
    "a", "about", "am", "an", "and", "any", "are", "as", "at", "be", "best",
    "but", "by", "can", "do", "does", "for", "from", "get", "good", "have",
    "how", "i", "if", "in", "is", "it", "many", "me", "much", "my", "of",
    "on", "or", "should", "so", "some", "than", "that", "the", "their",
    "there", "they", "this", "to", "was", "what", "when", "which", "who",
    "why", "will", "with", "would", "you", "your",
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Lowercase, split on non-alphanumerics, drop stopwords, light stemming."""
    tokens = _TOKEN_RE.findall(text.lower())
    out = []
    for t in tokens:
        if t in STOPWORDS or len(t) == 1:
            continue
        # crude suffix normalisation so "calories"/"calorie" collide
        if len(t) > 4 and t.endswith("ies"):
            t = t[:-3] + "y"
        elif len(t) > 4 and t.endswith("es"):
            t = t[:-2]
        elif len(t) > 3 and t.endswith("s"):
            t = t[:-1]
        out.append(t)
    return out


# --------------------------------------------------------------------------
# Documents
# --------------------------------------------------------------------------


@dataclass
class Doc:
    doc_id: str
    text: str
    row: dict[str, str] = field(default_factory=dict)
    tokens: list[str] = field(default_factory=list)


def load_documents(path: Path = DATASET_PATH) -> list[Doc]:
    """Read the CSV into Doc objects. Returns [] (not an exception) if absent."""
    if not path.exists():
        print(f"WARNING: dataset not found at {path}. Retrieval will be empty.")
        return []

    docs: list[Doc] = []
    with open(path, mode="r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            clean = {k.strip(): (v or "").strip()
                     for k, v in row.items() if k and v and v.strip()}
            if not clean:
                continue
            text = " | ".join(f"{k}: {v}" for k, v in clean.items())
            docs.append(Doc(doc_id=f"row-{i}", text=text, row=clean,
                            tokens=tokenize(text)))
    return docs


# --------------------------------------------------------------------------
# Lexical ranker: BM25
# --------------------------------------------------------------------------


class BM25:
    """Okapi BM25. Plain term-frequency cosine has no IDF, so common words like
    'protein' or 'day' carry the same weight as distinctive ones. BM25 fixes
    that and adds length normalisation, in about thirty lines."""

    def __init__(self, corpus: Sequence[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.corpus = list(corpus)
        self.n_docs = len(self.corpus)
        self.doc_len = [len(d) for d in self.corpus]
        self.avg_len = (sum(self.doc_len) / self.n_docs) if self.n_docs else 0.0
        self.tf = [Counter(d) for d in self.corpus]

        df: Counter[str] = Counter()
        for doc in self.corpus:
            df.update(set(doc))
        self.idf = {
            term: math.log(1 + (self.n_docs - n + 0.5) / (n + 0.5))
            for term, n in df.items()
        }

    def score(self, query_tokens: Iterable[str], index: int) -> float:
        if not self.n_docs or not self.avg_len:
            return 0.0
        tf, length = self.tf[index], self.doc_len[index]
        total = 0.0
        for term in query_tokens:
            freq = tf.get(term, 0)
            if not freq:
                continue
            idf = self.idf.get(term, 0.0)
            denom = freq + self.k1 * (1 - self.b + self.b * length / self.avg_len)
            total += idf * (freq * (self.k1 + 1)) / denom
        return total

    def rank(self, query: str, limit: int) -> list[tuple[int, float]]:
        q = tokenize(query)
        scored = [(i, self.score(q, i)) for i in range(self.n_docs)]
        scored = [s for s in scored if s[1] > 0]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]


# --------------------------------------------------------------------------
# Semantic ranker: dense embeddings via Ollama
# --------------------------------------------------------------------------


def cosine(v1: Sequence[float], v2: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(v1, v2))
    m1 = math.sqrt(sum(x * x for x in v1))
    m2 = math.sqrt(sum(x * x for x in v2))
    return dot / (m1 * m2) if m1 and m2 else 0.0


class DenseIndex:
    """Embeds documents once at boot and caches vectors on disk keyed by a hash
    of the document text, so a restart does not re-embed an unchanged corpus."""

    def __init__(self, docs: Sequence[Doc], model: str = EMBED_MODEL,
                 cache_path: Path = EMBED_CACHE_PATH):
        self.model = model
        self.cache_path = cache_path
        self.available = False
        self.vectors: list[list[float]] = []
        self._embedder = None
        self._build(docs)

    # -- embedder is created lazily so an unreachable Ollama cannot crash boot
    def _get_embedder(self):
        if self._embedder is None:
            from langchain_ollama import OllamaEmbeddings  # local import on purpose
            self._embedder = OllamaEmbeddings(model=self.model)
        return self._embedder

    @staticmethod
    def _key(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

    def _load_cache(self) -> dict[str, list[float]]:
        if self.cache_path.exists():
            try:
                return json.loads(self.cache_path.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        return {}

    def _save_cache(self, cache: dict[str, list[float]]) -> None:
        try:
            self.cache_path.write_text(json.dumps(cache))
        except OSError as exc:
            print(f"WARNING: could not write embedding cache: {exc}")

    def _build(self, docs: Sequence[Doc]) -> None:
        if not docs:
            return
        cache = self._load_cache()
        missing = [d for d in docs if self._key(d.text) not in cache]

        if missing:
            try:
                embedder = self._get_embedder()
                print(f"Embedding {len(missing)} document(s) with {self.model}...")
                vecs = embedder.embed_documents([d.text for d in missing])
                for doc, vec in zip(missing, vecs):
                    cache[self._key(doc.text)] = vec
                self._save_cache(cache)
            except Exception as exc:  # noqa: BLE001 - any failure means fall back
                print(f"WARNING: embeddings unavailable ({exc}). "
                      f"Falling back to lexical-only retrieval.")
                return

        try:
            self.vectors = [cache[self._key(d.text)] for d in docs]
            self.available = True
        except KeyError:
            self.available = False

    def embed_query(self, query: str) -> list[float] | None:
        if not self.available:
            return None
        try:
            return self._get_embedder().embed_query(query)
        except Exception as exc:  # noqa: BLE001
            print(f"WARNING: query embedding failed ({exc}).")
            return None

    def rank(self, query: str, limit: int) -> list[tuple[int, float]]:
        qv = self.embed_query(query)
        if qv is None:
            return []
        scored = [(i, cosine(qv, v)) for i, v in enumerate(self.vectors)]
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:limit]


# --------------------------------------------------------------------------
# Fusion + rerank
# --------------------------------------------------------------------------


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[tuple[int, float]]], k: int = RRF_K
) -> list[tuple[int, float]]:
    """Combine ranked lists without needing their scores to be comparable.
    BM25 scores are unbounded and cosines sit in [-1, 1], so fusing on raw
    score would let BM25 dominate. RRF uses rank position only."""
    fused: dict[int, float] = {}
    for ranked in ranked_lists:
        for rank, (idx, _score) in enumerate(ranked):
            fused[idx] = fused.get(idx, 0.0) + 1.0 / (k + rank + 1)
    return sorted(fused.items(), key=lambda x: x[1], reverse=True)


RERANK_PROMPT = """You grade whether a database row is relevant to a user's question.

Question: {query}

Rows:
{rows}

For each row, output a relevance grade:
2 = directly answers the question
1 = related and useful context
0 = not relevant

Respond with ONLY a JSON array of integers, one per row, in order.
No prose, no markdown fences. Example: [2,0,1]"""


@dataclass
class Result:
    doc: Doc
    score: float
    lexical_rank: int | None = None
    dense_rank: int | None = None
    rerank_grade: int | None = None


# --------------------------------------------------------------------------
# Retriever
# --------------------------------------------------------------------------


class Retriever:
    def __init__(self, docs: Sequence[Doc] | None = None, use_dense: bool = True,
                 use_lexical: bool = True, use_rerank: bool | None = None):
        if not (use_dense or use_lexical):
            raise ValueError("at least one of use_dense/use_lexical must be on")
        self.docs: list[Doc] = list(docs) if docs is not None else load_documents()
        self.use_lexical = use_lexical
        self.bm25 = BM25([d.tokens for d in self.docs]) if use_lexical else None
        self.dense = DenseIndex(self.docs) if use_dense else None
        if use_rerank is None:
            use_rerank = os.getenv("OPTIFIT_USE_RERANK", "0") == "1"
        self.use_rerank = use_rerank
        self._llm = None

    @property
    def mode(self) -> str:
        dense_on = bool(self.dense and self.dense.available)
        if dense_on and self.use_lexical:
            base = "hybrid"
        elif dense_on:
            base = "dense-only"
        else:
            base = "lexical-only"
        return f"{base}+rerank" if self.use_rerank else base

    def _get_llm(self):
        if self._llm is None:
            from langchain_ollama import ChatOllama
            self._llm = ChatOllama(model=LLM_MODEL, temperature=0)
        return self._llm

    # -- relevance floor ---------------------------------------------------
    def _passes_floor(self, query: str, candidates: list[Result],
                      dense_scores: dict[int, float]) -> bool:
        """Abstain rather than hand the generator an unrelated row. A query like
        'what is the capital of France' will still surface *some* row by cosine;
        the floor is what stops that row being presented as the answer."""
        if not candidates:
            return False
        if dense_scores:
            if max(dense_scores.values()) >= MIN_COSINE:
                return True
        q = set(tokenize(query))
        for result in candidates:
            if len(q & set(result.doc.tokens)) >= MIN_LEXICAL_OVERLAP:
                return True
        return False

    # -- rerank ------------------------------------------------------------
    def _rerank(self, query: str, candidates: list[Result]) -> list[Result]:
        rows = "\n".join(f"[{i}] {r.doc.text}" for i, r in enumerate(candidates))
        prompt = RERANK_PROMPT.format(query=query, rows=rows)
        try:
            from langchain_core.messages import HumanMessage
            raw = self._get_llm().invoke([HumanMessage(content=prompt)]).content
            cleaned = raw.strip().removeprefix("```json").removeprefix("```")
            cleaned = cleaned.removesuffix("```").strip()
            grades = json.loads(cleaned)
            if not isinstance(grades, list) or len(grades) != len(candidates):
                raise ValueError("grade list length mismatch")
        except Exception as exc:  # noqa: BLE001 - keep fused order on any failure
            print(f"WARNING: rerank failed ({exc}); keeping fusion order.")
            return candidates

        for result, grade in zip(candidates, grades):
            result.rerank_grade = int(grade)
        kept = [r for r in candidates if (r.rerank_grade or 0) > 0]
        kept.sort(key=lambda r: (r.rerank_grade or 0, r.score), reverse=True)
        return kept

    # -- public API --------------------------------------------------------
    def search(self, query: str, top_k: int = DEFAULT_TOP_K) -> list[Result]:
        """Return up to top_k results, or [] when nothing clears the floor."""
        if not self.docs:
            return []

        lexical = self.bm25.rank(query, CANDIDATE_POOL) if self.bm25 else []
        dense = self.dense.rank(query, CANDIDATE_POOL) if self.dense else []
        if not lexical and not dense:
            return []

        fused = reciprocal_rank_fusion([lexical, dense])
        lex_pos = {idx: rank for rank, (idx, _) in enumerate(lexical)}
        dense_pos = {idx: rank for rank, (idx, _) in enumerate(dense)}
        dense_scores = {idx: s for idx, s in dense}

        candidates = [
            Result(doc=self.docs[idx], score=score,
                   lexical_rank=lex_pos.get(idx), dense_rank=dense_pos.get(idx))
            for idx, score in fused[:CANDIDATE_POOL]
        ]

        if not self._passes_floor(query, candidates, dense_scores):
            return []

        if self.use_rerank:
            candidates = self._rerank(query, candidates)

        return candidates[:top_k]


# --------------------------------------------------------------------------
# Module-level singleton, built once at import (i.e. at server boot)
# --------------------------------------------------------------------------

_retriever: Retriever | None = None


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        _retriever = Retriever()
        print(f"OptiFit retriever ready: {len(_retriever.docs)} docs, "
              f"mode={_retriever.mode}")
    return _retriever
