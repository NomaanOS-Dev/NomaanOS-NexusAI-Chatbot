"""Unit tests for nexus-parser CLI."""

import json
from nexus_parser.cli import run_self_check


def test_cli_self_check(capsys):
    exit_code = run_self_check()
    assert exit_code == 0
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert data["status"] == "healthy"
    assert "PdfParser" in data["registered_parsers"]
    assert "MarkdownParser" in data["registered_parsers"]

