"""Markdown document extractor with structure-aware blocks, headings, code, and tables."""

import os
import re
from typing import Optional, List
from nexus_parser.base import BaseParser, MAX_PARSED_CHARS
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    HeadingItem,
    TableData,
    CodeBlock,
    ExtractionWarning,
)


class MarkdownParser(BaseParser):
    format = DocumentFormat.MARKDOWN

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        ext = os.path.splitext(filename.lower())[1]
        if ext in [".md", ".markdown", ".mdown", ".mkdn"]:
            return True
        if mime_type and ("markdown" in mime_type or mime_type == "text/x-markdown"):
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
        normalized_text = self.normalize_line_endings(raw_text)
        normalized_text = self.clean_text(normalized_text)

        warnings: List[ExtractionWarning] = []
        if encoding_warning:
            warnings.append(encoding_warning)

        if len(normalized_text) > MAX_PARSED_CHARS:
            normalized_text = normalized_text[:MAX_PARSED_CHARS]
            warnings.append(
                ExtractionWarning(
                    code="CONTENT_TRUNCATED",
                    message="Markdown exceeded max safety limit and was truncated.",
                )
            )

        blocks: List[ContentBlock] = []
        headings: List[HeadingItem] = []
        tables: List[TableData] = []
        code_blocks: List[CodeBlock] = []

        lines = normalized_text.split("\n")
        i = 0
        n = len(lines)
        doc_title: Optional[str] = None

        while i < n:
            line = lines[i]
            stripped = line.strip()

            # 1. Fenced Code Block: ```lang ... ```
            if stripped.startswith("```"):
                lang = stripped[3:].strip() or None
                code_lines: List[str] = []
                i += 1
                while i < n and not lines[i].strip().startswith("```"):
                    code_lines.append(lines[i])
                    i += 1
                # Advance past closing ```
                if i < n:
                    i += 1
                full_code = "\n".join(code_lines)
                code_blocks.append(CodeBlock(code=full_code, language=lang))
                blocks.append(
                    ContentBlock(
                        block_type=BlockType.CODE.value,
                        content=full_code,
                        language=lang,
                    )
                )
                continue

            # 2. Markdown Headings: # Heading
            heading_match = re.match(r"^(#{1,6})\s+(.+)$", stripped)
            if heading_match:
                level = len(heading_match.group(1))
                heading_text = heading_match.group(2).strip()
                headings.append(HeadingItem(title=heading_text, level=level))
                blocks.append(
                    ContentBlock(
                        block_type=BlockType.HEADING.value,
                        content=heading_text,
                        level=level,
                    )
                )
                if doc_title is None and level == 1:
                    doc_title = heading_text
                i += 1
                continue

            # 3. Markdown Table: | col1 | col2 |
            if stripped.startswith("|") and stripped.endswith("|") and "|" in stripped[1:-1]:
                # Lookahead for separator row | --- | --- |
                if i + 1 < n and re.match(r"^\|(?:\s*:?-+:?\s*\|)+$", lines[i + 1].strip()):
                    header_line = stripped
                    sep_line = lines[i + 1].strip()
                    headers = [c.strip() for c in header_line.strip("|").split("|")]
                    rows: List[List[str]] = []
                    i += 2  # skip header and separator
                    while i < n and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
                        row_cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                        rows.append(row_cells)
                        i += 1
                    table_obj = TableData(headers=headers, rows=rows)
                    tables.append(table_obj)
                    table_md = f"{header_line}\n{sep_line}\n" + "\n".join(
                        ["| " + " | ".join(r) + " |" for r in rows]
                    )
                    blocks.append(
                        ContentBlock(
                            block_type=BlockType.TABLE.value,
                            content=table_md,
                            metadata={"columns": headers, "row_count": len(rows)},
                        )
                    )
                    continue

            # 4. List items: - item, * item, 1. item
            if re.match(r"^(\*|-|\+|\d+\.)\s+(.+)$", stripped):
                list_lines: List[str] = [stripped]
                i += 1
                while i < n and (
                    re.match(r"^(\*|-|\+|\d+\.)\s+(.+)$", lines[i].strip())
                    or (lines[i].startswith("  ") and lines[i].strip())
                ):
                    list_lines.append(lines[i].strip())
                    i += 1
                blocks.append(
                    ContentBlock(
                        block_type=BlockType.LIST.value,
                        content="\n".join(list_lines),
                    )
                )
                continue

            # 5. Regular paragraph
            if stripped:
                para_lines: List[str] = [stripped]
                i += 1
                while i < n and lines[i].strip() and not lines[i].strip().startswith(("#", "```", "|", "* ", "- ", "1. ")):
                    para_lines.append(lines[i].strip())
                    i += 1
                blocks.append(
                    ContentBlock(
                        block_type=BlockType.PARAGRAPH.value,
                        content=" ".join(para_lines),
                    )
                )
                continue

            i += 1

        # Fallback title if not yet resolved
        if doc_title is None:
            if headings:
                doc_title = headings[0].title
            else:
                doc_title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").title()

        doc = NormalizedDocument(
            title=doc_title,
            format=self.format.value,
            normalized_text=normalized_text.strip(),
            blocks=blocks,
            headings=headings,
            tables=tables,
            code_blocks=code_blocks,
            warnings=warnings,
        )

        doc.metadata = self.create_metadata(
            content_bytes=content_bytes,
            filename=filename,
            mime_type=mime_type or "text/markdown",
            text=doc.normalized_text,
            block_count=len(blocks),
        )

        doc.finalize_status()
        return doc

