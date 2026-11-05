"""Plain text document extractor."""

import os
import re
from typing import Optional, List
from nexus_parser.base import BaseParser, MAX_PARSED_CHARS
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    ExtractionWarning,
)


class PlainTextParser(BaseParser):
    format = DocumentFormat.PLAIN_TEXT

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        ext = os.path.splitext(filename.lower())[1]
        if ext in [".txt", ".text", ".log", ".ini", ".cfg", ".conf"]:
            return True
        if mime_type and mime_type.startswith("text/plain"):
            return True
        return False

    def parse(
        self,
        content_bytes: bytes,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> NormalizedDocument:
        if len(content_bytes) == 0:
            raise ValueError("Cannot parse empty file: 0 bytes received.")

        # Decode text safely
        raw_text, encoding_warning = self.decode_text(content_bytes)
        normalized_text = self.normalize_line_endings(raw_text)
        normalized_text = self.clean_text(normalized_text)

        warnings: List[ExtractionWarning] = []
        if encoding_warning:
            warnings.append(encoding_warning)

        # Check resource limit
        if len(normalized_text) > MAX_PARSED_CHARS:
            normalized_text = normalized_text[:MAX_PARSED_CHARS]
            warnings.append(
                ExtractionWarning(
                    code="CONTENT_TRUNCATED",
                    message=f"Text exceeded safety limit of {MAX_PARSED_CHARS} characters and was truncated.",
                    severity="warning",
                )
            )

        # Split into meaningful paragraphs (separated by 2 or more newlines)
        raw_paragraphs = re.split(r"\n\s*\n+", normalized_text)
        blocks: List[ContentBlock] = []

        for p in raw_paragraphs:
            clean_p = p.strip()
            if clean_p:
                blocks.append(
                    ContentBlock(
                        block_type=BlockType.PARAGRAPH.value,
                        content=clean_p,
                    )
                )

        # Derive title: first non-empty line or sanitized filename
        title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").title()
        if blocks and len(blocks[0].content) < 100:
            first_line = blocks[0].content.split("\n")[0].strip()
            if len(first_line) > 3 and not first_line.startswith(("http", "{", "[")):
                title = first_line

        doc = NormalizedDocument(
            title=title,
            format=self.format.value,
            normalized_text=normalized_text.strip(),
            blocks=blocks,
            warnings=warnings,
        )

        doc.metadata = self.create_metadata(
            content_bytes=content_bytes,
            filename=filename,
            mime_type=mime_type or "text/plain",
            text=doc.normalized_text,
            block_count=len(blocks),
        )

        doc.finalize_status()
        return doc

