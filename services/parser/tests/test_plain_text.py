"""Unit tests for PlainTextParser."""

import pytest
from nexus_parser.parsers.plain_text import PlainTextParser
from nexus_parser.models import ExtractionStatus, DocumentFormat


def test_plain_text_success(synthetic_txt_bytes):
    parser = PlainTextParser()
    assert parser.can_parse("readme.txt") is True
    assert parser.can_parse("notes.log") is True
    assert parser.can_parse("image.png") is False

    doc = parser.parse(synthetic_txt_bytes, "architecture.txt")
    assert doc.status == ExtractionStatus.COMPLETED.value
    assert doc.format == DocumentFormat.PLAIN_TEXT.value
    assert "NomaanOS Nexus AI Platform Architecture" in doc.title
    assert "Multi-tenant isolation" in doc.normalized_text
    assert len(doc.blocks) >= 2
    assert doc.metadata is not None
    assert doc.metadata.word_count > 0
    assert doc.metadata.sha256 is not None


def test_plain_text_empty_rejection():
    parser = PlainTextParser()
    with pytest.raises(ValueError, match="Cannot parse empty file"):
        parser.parse(b"", "empty.txt")


def test_plain_text_encoding_fallback():
    parser = PlainTextParser()
    # Non-UTF8 byte sequence (e.g. latin-1 0xe9 = é)
    bad_utf8 = b"Hello world with invalid byte \xe9 here."
    doc = parser.parse(bad_utf8, "fallback.txt")
    assert doc.status in (
        ExtractionStatus.COMPLETED.value,
        ExtractionStatus.COMPLETED_WITH_WARNINGS.value,
    )
    assert len(doc.warnings) >= 1
    assert "invalid UTF-8" in doc.warnings[0].message

