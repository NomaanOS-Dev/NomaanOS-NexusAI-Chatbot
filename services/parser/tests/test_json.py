"""Unit tests for JsonParser."""

import pytest
from nexus_parser.parsers.json_doc import JsonParser
from nexus_parser.models import ExtractionStatus, DocumentFormat


def test_json_doc_success(synthetic_json_doc_bytes):
    parser = JsonParser()
    assert parser.can_parse("config.json") is True
    assert parser.can_parse("data.xml") is False

    doc = parser.parse(synthetic_json_doc_bytes, "cluster_config.json")
    assert doc.status == ExtractionStatus.COMPLETED.value
    assert doc.format == DocumentFormat.JSON.value
    assert doc.title == "Cluster Configuration"
    assert "node-alpha" in doc.normalized_text
    assert "production" in doc.normalized_text
    assert len(doc.blocks) >= 4


def test_json_recursion_depth_limit():
    parser = JsonParser()
    # Create deeply nested object (>20 levels)
    deep = {}
    curr = deep
    for i in range(25):
        curr["nested"] = {}
        curr = curr["nested"]
    import json
    deep_bytes = json.dumps(deep).encode("utf-8")

    with pytest.raises(ValueError, match="JSON nesting depth exceeded"):
        parser.parse(deep_bytes, "bomb.json")


def test_json_malformed():
    parser = JsonParser()
    bad_json = b"{\"key\": \"val\", unquoted: broken}"
    with pytest.raises(ValueError, match="Malformed JSON"):
        parser.parse(bad_json, "broken.json")

