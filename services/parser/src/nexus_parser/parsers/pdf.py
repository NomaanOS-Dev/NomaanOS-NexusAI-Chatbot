"""PDF document extractor using pypdf."""

import io
import os
import re
from typing import Optional, List
from pypdf import PdfReader
from pypdf.errors import PdfReadError, FileNotDecryptedError
from nexus_parser.base import BaseParser, MAX_PARSED_CHARS
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    ExtractionWarning,
)


class PdfParser(BaseParser):
    format = DocumentFormat.PDF

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        ext = os.path.splitext(filename.lower())[1]
        if ext == ".pdf":
            return True
        if mime_type and "application/pdf" in mime_type:
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

        # Check PDF Magic Header %PDF-
        if not content_bytes.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF: Missing '%PDF-' file signature.")

        warnings: List[ExtractionWarning] = []
        blocks: List[ContentBlock] = []
        page_references: List[int] = []
        accumulated_text_parts: List[str] = []

        try:
            reader = PdfReader(io.BytesIO(content_bytes))
        except PdfReadError as err:
            raise ValueError(f"Malformed or corrupt PDF: {str(err)}")
        except Exception as err:
            raise ValueError(f"Failed to initialize PDF reader: {str(err)}")

        if reader.is_encrypted:
            # Try decrypting with empty password
            try:
                decrypted = reader.decrypt("")
                if decrypted == 0:
                    raise FileNotDecryptedError("Password protected PDF.")
            except Exception:
                raise ValueError("PDF is encrypted and password-protected; cannot extract text without credentials.")

        num_pages = len(reader.pages)
        if num_pages == 0:
            warnings.append(
                ExtractionWarning(
                    code="EMPTY_PDF",
                    message="PDF document contains zero pages.",
                    severity="warning",
                )
            )

        empty_page_count = 0

        for page_idx, page in enumerate(reader.pages, start=1):
            page_references.append(page_idx)
            try:
                page_text = page.extract_text() or ""
            except Exception as page_err:
                warnings.append(
                    ExtractionWarning(
                        code="PAGE_EXTRACTION_ERROR",
                        message=f"Failed extracting text from page {page_idx}: {str(page_err)}",
                        location=f"page {page_idx}",
                    )
                )
                continue

            cleaned = self.clean_text(self.normalize_line_endings(page_text)).strip()

            if not cleaned:
                empty_page_count += 1
                warnings.append(
                    ExtractionWarning(
                        code="EMPTY_PAGE_OR_IMAGE",
                        message=f"Page {page_idx} contains no extractable text. Scanned images or vector graphics require OCR.",
                        location=f"page {page_idx}",
                        severity="info",
                    )
                )
                continue

            accumulated_text_parts.append(cleaned)

            # Split page text into paragraphs
            page_paragraphs = re.split(r"\n\s*\n+", cleaned)
            for p in page_paragraphs:
                p_clean = p.strip()
                if p_clean:
                    blocks.append(
                        ContentBlock(
                            block_type=BlockType.PARAGRAPH.value,
                            content=p_clean,
                            page=page_idx,
                        )
                    )

        if empty_page_count == num_pages and num_pages > 0:
            warnings.append(
                ExtractionWarning(
                    code="NO_TEXT_EXTRACTED",
                    message="Entire PDF contains no digital text. Optical Character Recognition (OCR) is not currently enabled.",
                    severity="warning",
                )
            )

        normalized_text = "\n\n".join(accumulated_text_parts).strip()
        if len(normalized_text) > MAX_PARSED_CHARS:
            normalized_text = normalized_text[:MAX_PARSED_CHARS]
            warnings.append(
                ExtractionWarning(
                    code="CONTENT_TRUNCATED",
                    message="PDF text output exceeded maximum safety limit and was truncated.",
                )
            )

        # Title from PDF metadata or filename
        title: Optional[str] = None
        if reader.metadata and reader.metadata.title:
            try:
                title = str(reader.metadata.title).strip()
            except Exception:
                pass

        if not title:
            title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").title()

        doc = NormalizedDocument(
            title=title,
            format=self.format.value,
            normalized_text=normalized_text,
            blocks=blocks,
            page_references=page_references,
            warnings=warnings,
        )

        doc.metadata = self.create_metadata(
            content_bytes=content_bytes,
            filename=filename,
            mime_type=mime_type or "application/pdf",
            text=doc.normalized_text,
            page_count=num_pages,
            block_count=len(blocks),
        )

        doc.finalize_status()
        return doc

