"""Unit tests for Day 12 Local Reranker Adapter."""

import pytest
from nexus_parser.reranker import LocalRerankerAdapter


def test_reranker_initialization():
    adapter = LocalRerankerAdapter()
    assert adapter.model_id == "cross-encoder/ms-marco-MiniLM-L-6-v2"
    assert adapter.device == "cpu"


def test_reranker_scoring_order():
    adapter = LocalRerankerAdapter()
    query = "ERR_AUTH_EXPIRED"
    candidates = [
        "Unrelated document about Kafka broker partition rebalancing.",
        "When authentication tokens expire after 15 minutes, the system raises ERR_AUTH_EXPIRED.",
        "General notes on SRE and infrastructure setup.",
    ]

    scores = adapter.rerank_pairs(query, candidates)

    assert len(scores) == 3
    # Candidate 1 (index 1) should have the highest score because it directly matches the error code
    assert scores[1] > scores[0]
    assert scores[1] > scores[2]


def test_reranker_empty_candidates():
    adapter = LocalRerankerAdapter()
    scores = adapter.rerank_pairs("any query", [])
    assert scores == []


def test_reranker_offline_mode():
    adapter = LocalRerankerAdapter(offline_mode=True)
    assert adapter.offline_mode is True

    scores = adapter.rerank_pairs(
        "OAuth mTLS configuration",
        ["OAuth 2.1 with mTLS mutual authentication is required.", "Other text."],
    )
    assert len(scores) == 2
    assert scores[0] > scores[1]

