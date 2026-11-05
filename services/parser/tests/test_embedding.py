"""Tests for local embedding adapter (Day 9)."""

import pytest
import os
from nexus_parser.embedding import (
    LocalEmbeddingAdapter,
    DEFAULT_MODEL_ID,
    DEFAULT_DIMENSIONS,
    DimensionMismatchError,
    ModelNotFoundError,
    EmbeddingError
)


def test_model_info():
    adapter = LocalEmbeddingAdapter()
    info = adapter.get_model_info()
    assert info["model_id"] == DEFAULT_MODEL_ID
    assert info["dimensions"] == DEFAULT_DIMENSIONS
    assert info["provider"] == "local"
    assert info["distance_metric"] == "cosine"
    assert info["is_normalized"] is True


def test_embed_single_text():
    adapter = LocalEmbeddingAdapter()
    vector = adapter.embed_text("Antigravity neural retrieval system")
    assert isinstance(vector, list)
    assert len(vector) == 384
    assert adapter.validate_embedding(vector) is True
    # Verify L2 normalization: sum of squares ≈ 1.0
    norm_sq = sum(x * x for x in vector)
    assert abs(norm_sq - 1.0) < 1e-3


def test_embed_batch():
    adapter = LocalEmbeddingAdapter()
    texts = [
        "First document paragraph about AI",
        "Second document paragraph regarding databases",
        "Third paragraph describing vector search"
    ]
    vectors = adapter.embed_batch(texts)
    assert len(vectors) == 3
    for v in vectors:
        assert len(v) == 384
        assert adapter.validate_embedding(v) is True


def test_empty_and_whitespace_text():
    adapter = LocalEmbeddingAdapter()
    v1 = adapter.embed_text("")
    v2 = adapter.embed_text("   ")
    assert len(v1) == 384
    assert len(v2) == 384
    assert adapter.validate_embedding(v1) is True
    assert adapter.validate_embedding(v2) is True


def test_long_text_truncation_safety():
    adapter = LocalEmbeddingAdapter()
    long_text = "NomaanOS knowledge base chunk " * 1000
    vector = adapter.embed_text(long_text)
    assert len(vector) == 384
    assert adapter.validate_embedding(vector) is True


def test_validate_embedding():
    adapter = LocalEmbeddingAdapter()
    assert adapter.validate_embedding([0.1] * 384) is True
    assert adapter.validate_embedding([0.1] * 383) is False  # Wrong dim
    assert adapter.validate_embedding([0.1] * 768) is False  # Wrong dim
    assert adapter.validate_embedding("invalid") is False
    assert adapter.validate_embedding([float("nan")] + [0.1] * 383) is False  # NaN


def test_offline_mode_execution():
    adapter = LocalEmbeddingAdapter(offline_mode=True)
    assert adapter.offline_mode is True
    vector = adapter.embed_text("Testing explicit offline mode")
    assert len(vector) == 384


def test_offline_mode_missing_model():
    # If a non-existent model is requested in offline mode, it must fail with ModelNotFoundError
    adapter = LocalEmbeddingAdapter(model_id="non-existent/fake-model-day9", offline_mode=True)
    with pytest.raises(ModelNotFoundError):
        adapter._load_model()

