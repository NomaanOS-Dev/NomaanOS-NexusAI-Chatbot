"""Approved JSON document extractor with structure preservation and recursion safety."""

import os
import json
from typing import Optional, List, Dict, Any
from nexus_parser.base import BaseParser, MAX_PARSED_CHARS
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    ExtractionWarning,
)

MAX_JSON_DEPTH = 20


class JsonParser(BaseParser):
    format = DocumentFormat.JSON

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        ext = os.path.splitext(filename.lower())[1]
        if ext == ".json":
            return True
        if mime_type and "application/json" in mime_type:
            return True
        return False

    def _check_depth(self, obj: Any, current_depth: int = 0) -> int:
        if current_depth > MAX_JSON_DEPTH:
            raise ValueError(f"JSON nesting depth exceeded maximum threshold of {MAX_JSON_DEPTH} levels.")
        if isinstance(obj, dict):
            return max([self._check_depth(v, current_depth + 1) for v in obj.values()], default=current_depth)
        elif isinstance(obj, list):
            return max([self._check_depth(item, current_depth + 1) for item in obj], default=current_depth)
        return current_depth

    def _format_structure(self, obj: Any, prefix: str = "", blocks: Optional[List[ContentBlock]] = None) -> List[str]:
        lines: List[str] = []
        if blocks is None:
            blocks = []

        if isinstance(obj, dict):
            for k, v in obj.items():
                k_clean = str(k).strip()
                if isinstance(v, (dict, list)):
                    lines.append(f"{prefix}**{k_clean}:**")
                    blocks.append(
                        ContentBlock(
                            block_type=BlockType.SECTION.value,
                            content=f"{prefix}{k_clean}",
                        )
                    )
                    child_lines = self._format_structure(v, prefix + "  ", blocks)
                    lines.extend(child_lines)
                else:
                    line = f"{prefix}- **{k_clean}**: {v}"
                    lines.append(line)
                    blocks.append(
                        ContentBlock(
                            block_type=BlockType.KEY_VALUE.value,
                            content=line.strip(),
                            metadata={"key": k_clean, "value": v},
                        )
                    )
        elif isinstance(obj, list):
            for idx, item in enumerate(obj):
                if isinstance(item, (dict, list)):
                    lines.append(f"{prefix}[Item #{idx + 1}]")
                    child_lines = self._format_structure(item, prefix + "  ", blocks)
                    lines.extend(child_lines)
                else:
                    line = f"{prefix}- {item}"
                    lines.append(line)
                    blocks.append(
                        ContentBlock(
                            block_type=BlockType.PARAGRAPH.value,
                            content=line.strip(),
                        )
                    )
        else:
            line = f"{prefix}{obj}"
            lines.append(line)
            blocks.append(
                ContentBlock(
                    block_type=BlockType.RAW_TEXT.value,
                    content=line.strip(),
                )
            )

        return lines

    def parse(
        self,
        content_bytes: bytes,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> NormalizedDocument:
        if len(content_bytes) == 0:
            raise ValueError("Cannot parse empty file: 0 bytes received.")

        raw_text, encoding_warning = self.decode_text(content_bytes)
        warnings: List[ExtractionWarning] = []
        if encoding_warning:
            warnings.append(encoding_warning)

        try:
            parsed_data = json.loads(raw_text)
        except json.JSONDecodeError as err:
            raise ValueError(f"Malformed JSON: {err.msg} at line {err.lineno}, column {err.colno}.")

        # Guard against recursion bombs
        self._check_depth(parsed_data)

        blocks: List[ContentBlock] = []
        lines = self._format_structure(parsed_data, "", blocks)
        normalized_text = "\n".join(lines).strip()

        if len(normalized_text) > MAX_PARSED_CHARS:
            normalized_text = normalized_text[:MAX_PARSED_CHARS]
            warnings.append(
                ExtractionWarning(
                    code="CONTENT_TRUNCATED",
                    message="JSON text output exceeded safety limit and was truncated.",
                )
            )

        # Title heuristic
        title: Optional[str] = None
        if isinstance(parsed_data, dict):
            for key in ["title", "name", "documentTitle", "doc_name", "id"]:
                if key in parsed_data and isinstance(parsed_data[key], str) and parsed_data[key].strip():
                    title = parsed_data[key].strip()
                    break

        if not title:
            title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").title()

        doc = NormalizedDocument(
            title=title,
            format=self.format.value,
            normalized_text=normalized_text,
            blocks=blocks,
            warnings=warnings,
        )

        doc.metadata = self.create_metadata(
            content_bytes=content_bytes,
            filename=filename,
            mime_type=mime_type or "application/json",
            text=doc.normalized_text,
            block_count=len(blocks),
        )

        doc.finalize_status()
        return doc

