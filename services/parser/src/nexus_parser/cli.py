"""CLI interface for nexus-parser."""

import os
import sys
import json
import argparse
from nexus_parser import __version__
from nexus_parser.registry import parse_document, REGISTERED_PARSER_CLASSES


def run_self_check() -> int:
    """Diagnostic self-check reporting registered parsers and health."""
    diag = {
        "status": "healthy",
        "service": "nexus-parser",
        "version": __version__,
        "registered_parsers": [cls.__name__ for cls in REGISTERED_PARSER_CLASSES],
        "supported_formats": [
            ".txt",
            ".md",
            ".html",
            ".htm",
            ".pdf",
            ".json",
            "openapi (json/yaml)",
        ],
    }
    print(json.dumps(diag, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(
        prog="nexus-parser",
        description="NomaanOS Nexus AI Document Parser and Extractor",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Run self-check and output diagnostic JSON",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"nexus-parser {__version__}",
    )
    parser.add_argument(
        "file",
        nargs="?",
        help="Path to document file to parse",
    )
    parser.add_argument(
        "--mime-type",
        help="Optional MIME type override",
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="Read raw document bytes from standard input",
    )

    args = parser.parse_args()

    if args.self_check:
        sys.exit(run_self_check())

    if args.stdin:
        content_bytes = sys.stdin.buffer.read()
        filename = args.file or "stdin_document.txt"
        doc = parse_document(content_bytes, filename, args.mime_type)
        print(doc.to_json(indent=2))
        sys.exit(0 if doc.status != "failed" else 1)

    if not args.file:
        parser.print_help()
        sys.exit(1)

    if not os.path.exists(args.file):
        error_doc = {
            "error": "FileNotFound",
            "message": f"File not found: {args.file}",
            "status": "failed",
        }
        print(json.dumps(error_doc, indent=2), file=sys.stderr)
        sys.exit(2)

    try:
        with open(args.file, "rb") as f:
            content_bytes = f.read()
        doc = parse_document(content_bytes, args.file, args.mime_type)
        print(doc.to_json(indent=2))
        sys.exit(0 if doc.status != "failed" else 1)
    except Exception as ex:
        print(json.dumps({"error": "UnexpectedError", "message": str(ex), "status": "failed"}), file=sys.stderr)
        sys.exit(3)


if __name__ == "__main__":
    main()

