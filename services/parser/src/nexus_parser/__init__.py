"""NomaanOS Nexus AI Document Parser Package."""

from nexus_parser.models import (
    BlockType,
    ExtractionStatus,
    DocumentFormat,
    ExtractionWarning,
    ContentBlock,
    HeadingItem,
    TableData,
    CodeBlock,
    DocumentMetadata,
    NormalizedDocument,
)
from nexus_parser.base import BaseParser
from nexus_parser.registry import get_parser, parse_document, detect_format

__version__ = "0.1.0"
__all__ = [
    "BlockType",
    "ExtractionStatus",
    "DocumentFormat",
    "ExtractionWarning",
    "ContentBlock",
    "HeadingItem",
    "TableData",
    "CodeBlock",
    "DocumentMetadata",
    "NormalizedDocument",
    "BaseParser",
    "get_parser",
    "parse_document",
    "detect_format",
    "__version__",
]

