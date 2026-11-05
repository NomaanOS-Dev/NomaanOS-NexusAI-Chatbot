"""Unit tests for MarkdownParser."""

import pytest
from nexus_parser.parsers.markdown import MarkdownParser
from nexus_parser.models import ExtractionStatus, DocumentFormat, BlockType


def test_markdown_success(synthetic_md_bytes):
    parser = MarkdownParser()
    assert parser.can_parse("runbook.md") is True
    assert parser.can_parse("doc.markdown") is True

    doc = parser.parse(synthetic_md_bytes, "incident_response.md")
    assert doc.status == ExtractionStatus.COMPLETED.value
    assert doc.format == DocumentFormat.MARKDOWN.value
    assert doc.title == "Incident Response Guide"

    # Headings check
    assert len(doc.headings) == 3
    assert doc.headings[0].title == "Incident Response Guide"
    assert doc.headings[0].level == 1
    assert doc.headings[1].title == "Step 1: Containment"
    assert doc.headings[1].level == 2

    # Code block check
    assert len(doc.code_blocks) == 1
    assert "iptables -A INPUT" in doc.code_blocks[0].code
    assert doc.code_blocks[0].language == "bash"

    # Table check
    assert len(doc.tables) == 1
    assert doc.tables[0].headers == ["Level", "Response SLA", "Escalation"]
    assert len(doc.tables[0].rows) == 3
    assert doc.tables[0].rows[0][0] == "Critical"

    # Structured blocks check
    block_types = [b.block_type for b in doc.blocks]
    assert BlockType.HEADING.value in block_types
    assert BlockType.CODE.value in block_types
    assert BlockType.TABLE.value in block_types
    assert BlockType.LIST.value in block_types


def test_markdown_empty_rejection():
    parser = MarkdownParser()
    with pytest.raises(ValueError, match="Cannot parse empty file"):
        parser.parse(b"", "empty.md")

