"""Unit tests for OpenApiParser."""

import pytest
from nexus_parser.parsers.openapi import OpenApiParser
from nexus_parser.models import ExtractionStatus, DocumentFormat, BlockType


def test_openapi_json_success(synthetic_openapi_json_bytes):
    parser = OpenApiParser()
    assert parser.can_parse("openapi.json") is True
    assert parser.can_parse("swagger.json") is True
    assert parser.can_parse("api-spec.yaml") is True

    doc = parser.parse(synthetic_openapi_json_bytes, "openapi.json")
    assert doc.status == ExtractionStatus.COMPLETED.value
    assert doc.format == DocumentFormat.OPENAPI.value
    assert doc.title == "Sentinel Telemetry API"
    assert "Ingest Batch Events" in doc.normalized_text
    assert "POST /api/v1/telemetry/events" in doc.normalized_text

    # Verify structured block
    api_blocks = [b for b in doc.blocks if b.block_type == BlockType.API_PATH.value]
    assert len(api_blocks) == 1
    assert api_blocks[0].metadata["method"] == "POST"
    assert api_blocks[0].metadata["path"] == "/api/v1/telemetry/events"


def test_openapi_yaml_success():
    parser = OpenApiParser()
    yaml_spec = b"""openapi: "3.0.0"
info:
  title: "Cloud Ops API"
  version: "2.1.0"
paths:
  /healthz:
    get:
      summary: "Kubernetes Liveness Probe"
      responses:
        "200":
          description: "Healthy"
"""
    doc = parser.parse(yaml_spec, "swagger.yaml")
    assert doc.status == ExtractionStatus.COMPLETED.value
    assert doc.title == "Cloud Ops API"
    assert "GET /healthz" in doc.normalized_text


def test_openapi_missing_version_rejection():
    parser = OpenApiParser()
    bad_spec = b"""{"info": {"title": "No Version API"}}"""
    with pytest.raises(ValueError, match="Missing required 'openapi' or 'swagger'"):
        parser.parse(bad_spec, "openapi.json")


def test_openapi_syntax_error():
    parser = OpenApiParser()
    malformed_json = b"""{"openapi": "3.0.0", "unclosed_bracket": """
    with pytest.raises(ValueError, match="Syntax error parsing specification"):
        parser.parse(malformed_json, "openapi.json")

