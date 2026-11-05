"""Secure HTML document extractor using Python's standard library html.parser."""

import os
import re
from html.parser import HTMLParser as BaseHTMLParser
from typing import Optional, List, Dict, Any
from nexus_parser.base import BaseParser, MAX_PARSED_CHARS
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    HeadingItem,
    TableData,
    ExtractionWarning,
)


class SecureHTMLContentExtractor(BaseHTMLParser):
    """Parses HTML into text and structured blocks while ignoring scripts and remote resources."""

    DANGEROUS_TAGS = {"script", "style", "noscript", "svg", "canvas", "iframe", "object", "embed"}

    def __init__(self):
        super().__init__()
        self.stripped_scripts_count = 0
        self.title: Optional[str] = None
        self.headings: List[HeadingItem] = []
        self.tables: List[TableData] = []
        self.blocks: List[ContentBlock] = []

        self._in_dangerous_tag = 0
        self._current_tag: Optional[str] = None
        self._current_text: List[str] = []
        self._in_title = False
        self._in_heading: Optional[int] = None
        self._in_table = False
        self._current_table_headers: List[str] = []
        self._current_table_rows: List[List[str]] = []
        self._current_row: List[str] = []
        self._in_th = False
        self._in_td = False

    def handle_starttag(self, tag: str, attrs: List[tuple]):
        tag = tag.lower()

        if tag in self.DANGEROUS_TAGS:
            self._in_dangerous_tag += 1
            if tag == "script":
                self.stripped_scripts_count += 1
            return

        if self._in_dangerous_tag > 0:
            return

        self._current_tag = tag

        if tag == "title":
            self._in_title = True
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush_text()
            self._in_heading = int(tag[1])
        elif tag == "table":
            self._flush_text()
            self._in_table = True
            self._current_table_headers = []
            self._current_table_rows = []
        elif tag == "tr" and self._in_table:
            self._current_row = []
        elif tag == "th" and self._in_table:
            self._in_th = True
        elif tag == "td" and self._in_table:
            self._in_td = True
        elif tag in ("p", "div", "section", "article", "blockquote", "li"):
            self._flush_text()

    def handle_endtag(self, tag: str):
        tag = tag.lower()

        if tag in self.DANGEROUS_TAGS:
            if self._in_dangerous_tag > 0:
                self._in_dangerous_tag -= 1
            return

        if self._in_dangerous_tag > 0:
            return

        if tag == "title":
            self._in_title = False
            title_candidate = "".join(self._current_text).strip()
            if title_candidate:
                self.title = title_candidate
            self._current_text = []
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self._in_heading:
            heading_text = "".join(self._current_text).strip()
            if heading_text:
                self.headings.append(HeadingItem(title=heading_text, level=self._in_heading))
                self.blocks.append(
                    ContentBlock(
                        block_type=BlockType.HEADING.value,
                        content=heading_text,
                        level=self._in_heading,
                    )
                )
                if not self.title and self._in_heading == 1:
                    self.title = heading_text
            self._current_text = []
            self._in_heading = None
        elif tag == "th" and self._in_table:
            cell_text = "".join(self._current_text).strip()
            self._current_row.append(cell_text)
            self._current_text = []
            self._in_th = False
        elif tag == "td" and self._in_table:
            cell_text = "".join(self._current_text).strip()
            self._current_row.append(cell_text)
            self._current_text = []
            self._in_td = False
        elif tag == "tr" and self._in_table:
            if self._current_row:
                if not self._current_table_headers and any(self._current_row):
                    self._current_table_headers = self._current_row
                else:
                    self._current_table_rows.append(self._current_row)
            self._current_row = []
        elif tag == "table" and self._in_table:
            if self._current_table_headers or self._current_table_rows:
                t = TableData(headers=self._current_table_headers, rows=self._current_table_rows)
                self.tables.append(t)
                summary_lines = []
                if t.headers:
                    summary_lines.append("| " + " | ".join(t.headers) + " |")
                for r in t.rows:
                    summary_lines.append("| " + " | ".join(r) + " |")
                self.blocks.append(
                    ContentBlock(
                        block_type=BlockType.TABLE.value,
                        content="\n".join(summary_lines),
                        metadata={"headers": t.headers, "row_count": len(t.rows)},
                    )
                )
            self._in_table = False
            self._current_table_headers = []
            self._current_table_rows = []
        elif tag in ("p", "div", "section", "article", "blockquote", "li"):
            self._flush_text()

    def handle_data(self, data: str):
        if self._in_dangerous_tag > 0:
            return
        if data:
            self._current_text.append(data)

    def _flush_text(self):
        text = "".join(self._current_text).strip()
        self._current_text = []
        if text and not self._in_heading and not self._in_th and not self._in_td:
            # Collapse multiple spaces and newlines
            clean = re.sub(r"\s+", " ", text).strip()
            if len(clean) > 1:
                self.blocks.append(
                    ContentBlock(
                        block_type=BlockType.PARAGRAPH.value,
                        content=clean,
                    )
                )


class HtmlParser(BaseParser):
    format = DocumentFormat.HTML

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        ext = os.path.splitext(filename.lower())[1]
        if ext in [".html", ".htm", ".xhtml"]:
            return True
        if mime_type and "text/html" in mime_type:
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

        raw_text, encoding_warning = self.decode_text(content_bytes)
        normalized_raw = self.normalize_line_endings(raw_text)

        warnings: List[ExtractionWarning] = []
        if encoding_warning:
            warnings.append(encoding_warning)

        extractor = SecureHTMLContentExtractor()
        try:
            extractor.feed(normalized_raw)
            extractor.close()
        except Exception as ex:
            raise ValueError(f"HTML parsing failed: {str(ex)}")

        if extractor.stripped_scripts_count > 0:
            warnings.append(
                ExtractionWarning(
                    code="STRIPPED_SCRIPTS",
                    message=f"Stripped {extractor.stripped_scripts_count} <script> element(s) for security.",
                    severity="info",
                )
            )

        # Assemble normalized text from blocks
        normalized_text = "\n\n".join([b.content for b in extractor.blocks])
        if len(normalized_text) > MAX_PARSED_CHARS:
            normalized_text = normalized_text[:MAX_PARSED_CHARS]
            warnings.append(
                ExtractionWarning(
                    code="CONTENT_TRUNCATED",
                    message="HTML content exceeded safety threshold and was truncated.",
                )
            )

        title = extractor.title
        if not title:
            if extractor.headings:
                title = extractor.headings[0].title
            else:
                title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").title()

        doc = NormalizedDocument(
            title=title,
            format=self.format.value,
            normalized_text=normalized_text.strip(),
            blocks=extractor.blocks,
            headings=extractor.headings,
            tables=extractor.tables,
            warnings=warnings,
        )

        doc.metadata = self.create_metadata(
            content_bytes=content_bytes,
            filename=filename,
            mime_type=mime_type or "text/html",
            text=doc.normalized_text,
            block_count=len(extractor.blocks),
        )

        doc.finalize_status()
        return doc

