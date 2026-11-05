"""Unit tests for HtmlParser."""

import pytest
from nexus_parser.parsers.html import HtmlParser
from nexus_parser.models import ExtractionStatus, DocumentFormat, BlockType


def test_html_success(synthetic_html_bytes):
    parser = HtmlParser()
    assert parser.can_parse("page.html") is True
    assert parser.can_parse("index.htm") is True

    doc = parser.parse(synthetic_html_bytes, "runbook.html")
    assert doc.status == ExtractionStatus.COMPLETED_WITH_WARNINGS.value
    assert doc.format == DocumentFormat.HTML.value
    assert doc.title == "Cloud Deployment Runbook"

    # Security check: Scripts and Styles MUST be excluded
    assert "alert('Malicious Code Execution Attempt')" not in doc.normalized_text
    assert "color: red" not in doc.normalized_text
    assert "evil.example.com" not in doc.normalized_text

    # Content extraction check
    assert "Production Cluster Operations" in doc.normalized_text
    assert "emergency recovery procedures for PostgreSQL 16" in doc.normalized_text

    # Warnings check: Stripped scripts warning recorded
    stripped_warnings = [w for w in doc.warnings if w.code == "STRIPPED_SCRIPTS"]
    assert len(stripped_warnings) == 1

    # Tables check
    assert len(doc.tables) >= 1
    assert "Metric" in doc.tables[0].headers
    assert "Threshold" in doc.tables[0].headers


def test_html_empty_rejection():
    parser = HtmlParser()
    with pytest.raises(ValueError, match="Cannot parse empty file"):
        parser.parse(b"", "empty.html")

