"""Parser registry, format detection, and unified extraction dispatcher."""

import os
from typing import Optional, List, Type
from nexus_parser.base import BaseParser
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ExtractionStatus,
    DocumentMetadata,
)
from nexus_parser.parsers.plain_text import PlainTextParser
from nexus_parser.parsers.markdown import MarkdownParser
from nexus_parser.parsers.html import HtmlParser
from nexus_parser.parsers.pdf import PdfParser
from nexus_parser.parsers.openapi import OpenApiParser
from nexus_parser.parsers.json_doc import JsonParser

# Ordered list of parsers (OpenAPI before generic JSON)
REGISTERED_PARSER_CLASSES: List[Type[BaseParser]] = [
    PdfParser,
    OpenApiParser,
    MarkdownParser,
    HtmlParser,
    JsonParser,
    PlainTextParser,
]


def detect_format(filename: str, mime_type: Optional[str] = None, sample: bytes = b"") -> DocumentFormat:
    """Infers the document format from filename, MIME type, and content magic bytes."""
    lower_fn = filename.lower()
    ext = os.path.splitext(lower_fn)[1]

    # PDF signature
    if sample.startswith(b"%PDF-") or ext == ".pdf":
        return DocumentFormat.PDF

    # OpenAPI hints
    if any(k in lower_fn for k in ["openapi", "swagger", "api-spec"]):
        if ext in [".json", ".yaml", ".yml"]:
            return DocumentFormat.OPENAPI

    # Markdown
    if ext in [".md", ".markdown"]:
        return DocumentFormat.MARKDOWN

    # HTML
    if ext in [".html", ".htm", ".xhtml"]:
        return DocumentFormat.HTML

    # JSON
    if ext == ".json":
        return DocumentFormat.JSON

    # Plain text
    if ext in [".txt", ".text", ".log", ".cfg", ".ini", ".conf"]:
        return DocumentFormat.PLAIN_TEXT

    if mime_type:
        if "pdf" in mime_type:
            return DocumentFormat.PDF
        if "markdown" in mime_type:
            return DocumentFormat.MARKDOWN
        if "html" in mime_type:
            return DocumentFormat.HTML
        if "json" in mime_type:
            return DocumentFormat.JSON
        if "text/plain" in mime_type:
            return DocumentFormat.PLAIN_TEXT

    return DocumentFormat.UNKNOWN


def get_parser(filename: str, mime_type: Optional[str] = None, sample: bytes = b"") -> Optional[BaseParser]:
    """Retrieves an instantiated parser matching the given file."""
    for parser_cls in REGISTERED_PARSER_CLASSES:
        parser = parser_cls()
        if parser.can_parse(filename, mime_type):
            return parser
    return None


def parse_document(
    content_bytes: bytes,
    filename: str,
    mime_type: Optional[str] = None,
) -> NormalizedDocument:
    """Unified entry point: detects format, executes parser, and guarantees structured return."""
    clean_filename = os.path.basename(filename)

    if not content_bytes or len(content_bytes) == 0:
        doc = NormalizedDocument(
            title=clean_filename,
            format=DocumentFormat.UNKNOWN.value,
            status=ExtractionStatus.FAILED.value,
            error_message="Uploaded document is completely empty (0 bytes).",
        )
        doc.metadata = DocumentMetadata(
            filename=clean_filename,
            file_size_bytes=0,
            mime_type=mime_type or "application/octet-stream",
            sha256=BaseParser.calculate_sha256(content_bytes or b""),
        )
        return doc

    parser = get_parser(clean_filename, mime_type, content_bytes[:1024])
    if not parser:
        doc = NormalizedDocument(
            title=clean_filename,
            format=DocumentFormat.UNKNOWN.value,
            status=ExtractionStatus.FAILED.value,
            error_message=f"Unsupported file format for '{clean_filename}'. Supported formats: .txt, .md, .html, .pdf, .json, OpenAPI specs.",
        )
        doc.metadata = DocumentMetadata(
            filename=clean_filename,
            file_size_bytes=len(content_bytes),
            mime_type=mime_type or "application/octet-stream",
            sha256=BaseParser.calculate_sha256(content_bytes),
        )
        return doc

    try:
        return parser.parse(content_bytes, clean_filename, mime_type)
    except Exception as ex:
        doc = NormalizedDocument(
            title=clean_filename,
            format=parser.format.value,
            status=ExtractionStatus.FAILED.value,
            error_message=f"Extraction failure: {str(ex)}",
        )
        doc.metadata = DocumentMetadata(
            filename=clean_filename,
            file_size_bytes=len(content_bytes),
            mime_type=mime_type or "application/octet-stream",
            sha256=BaseParser.calculate_sha256(content_bytes),
        )
        return doc

