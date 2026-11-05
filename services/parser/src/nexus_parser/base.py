"""Base parser interface and common utilities for Nexus AI document extractors."""

from abc import ABC, abstractmethod
import hashlib
import re
from typing import Optional, List, Tuple
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    DocumentMetadata,
    ExtractionWarning,
)

MAX_PARSED_CHARS = 10_000_000  # 10M characters safety limit against resource exhaustion


class BaseParser(ABC):
    """Abstract base class for all format-specific document extractors."""

    format: DocumentFormat = DocumentFormat.UNKNOWN

    @abstractmethod
    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        """Determines if this parser handles the given file type."""
        pass

    @abstractmethod
    def parse(
        self,
        content_bytes: bytes,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> NormalizedDocument:
        """Parses raw content bytes and returns a structured NormalizedDocument."""
        pass

    @staticmethod
    def calculate_sha256(content_bytes: bytes) -> str:
        """Calculates cryptographic SHA-256 digest of raw binary bytes."""
        return hashlib.sha256(content_bytes).hexdigest()

    @staticmethod
    def normalize_line_endings(text: str) -> str:
        """Normalizes Windows CRLF and classic Mac CR to standard LF."""
        return text.replace("\r\n", "\n").replace("\r", "\n")

    @staticmethod
    def clean_text(text: str) -> str:
        """Strips null bytes and non-printable control characters (except whitespace)."""
        # Remove null bytes
        cleaned = text.replace("\x00", "")
        # Remove other unprintable ASCII controls (except \t and \n)
        cleaned = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
        return cleaned

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Fast heuristic estimation (~4 characters per token for English/code)."""
        if not text:
            return 0
        words = len(text.split())
        chars = len(text)
        return max(words, chars // 4)

    @staticmethod
    def decode_text(
        content_bytes: bytes,
    ) -> Tuple[str, Optional[ExtractionWarning]]:
        """Safely decodes text using UTF-8 with fallback to Latin-1 or UTF-16."""
        warning: Optional[ExtractionWarning] = None

        try:
            return content_bytes.decode("utf-8"), None
        except UnicodeDecodeError:
            pass

        # Try UTF-8 with replacement
        try:
            decoded = content_bytes.decode("utf-8", errors="replace")
            warning = ExtractionWarning(
                code="ENCODING_FALLBACK_REPLACED",
                message="File contained invalid UTF-8 byte sequences; non-decodable characters were replaced.",
                severity="warning",
            )
            return decoded, warning
        except Exception as ex:
            raise ValueError(f"Failed to decode text: {str(ex)}")

    def create_metadata(
        self,
        content_bytes: bytes,
        filename: str,
        mime_type: Optional[str],
        text: str,
        page_count: Optional[int] = None,
        block_count: int = 0,
    ) -> DocumentMetadata:
        """Constructs standardized document metadata."""
        clean = text.strip()
        words = len(clean.split()) if clean else 0
        chars = len(clean)

        return DocumentMetadata(
            filename=filename,
            file_size_bytes=len(content_bytes),
            mime_type=mime_type or "application/octet-stream",
            sha256=self.calculate_sha256(content_bytes),
            character_count=chars,
            word_count=words,
            estimated_tokens=self.estimate_tokens(clean),
            page_count=page_count,
            block_count=block_count,
        )

