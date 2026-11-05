"""Data models for normalized documents and extraction results in NomaanOS Nexus AI."""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Dict, Any, List
import json


class BlockType(str, Enum):
    PARAGRAPH = "paragraph"
    HEADING = "heading"
    CODE = "code"
    TABLE = "table"
    LIST = "list"
    API_PATH = "api_path"
    KEY_VALUE = "key_value"
    SECTION = "section"
    RAW_TEXT = "raw_text"


class ExtractionStatus(str, Enum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    COMPLETED = "completed"
    COMPLETED_WITH_WARNINGS = "completed_with_warnings"
    FAILED = "failed"


class DocumentFormat(str, Enum):
    PLAIN_TEXT = "plain_text"
    MARKDOWN = "markdown"
    HTML = "html"
    PDF = "pdf"
    OPENAPI = "openapi"
    JSON = "json"
    UNKNOWN = "unknown"


@dataclass
class ExtractionWarning:
    code: str
    message: str
    location: Optional[str] = None
    severity: str = "warning"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "location": self.location,
            "severity": self.severity,
        }


@dataclass
class HeadingItem:
    title: str
    level: int
    page: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "level": self.level,
            "page": self.page,
        }


@dataclass
class TableData:
    headers: List[str]
    rows: List[List[str]]
    caption: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "headers": self.headers,
            "rows": self.rows,
            "caption": self.caption,
        }


@dataclass
class CodeBlock:
    code: str
    language: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "language": self.language,
        }


@dataclass
class ContentBlock:
    block_type: str
    content: str
    level: Optional[int] = None
    language: Optional[str] = None
    page: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "block_type": self.block_type,
            "content": self.content,
            "level": self.level,
            "language": self.language,
            "page": self.page,
            "metadata": self.metadata,
        }


@dataclass
class DocumentMetadata:
    filename: str
    file_size_bytes: int
    mime_type: str
    sha256: str
    character_count: int = 0
    word_count: int = 0
    estimated_tokens: int = 0
    page_count: Optional[int] = None
    block_count: int = 0
    parser_name: str = "nexus-parser"
    parser_version: str = "0.1.0"
    extracted_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class NormalizedDocument:
    schema_version: str = "1.0.0"
    title: str = "Untitled Document"
    format: str = DocumentFormat.UNKNOWN.value
    status: str = ExtractionStatus.COMPLETED.value
    normalized_text: str = ""
    blocks: List[ContentBlock] = field(default_factory=list)
    headings: List[HeadingItem] = field(default_factory=list)
    tables: List[TableData] = field(default_factory=list)
    code_blocks: List[CodeBlock] = field(default_factory=list)
    page_references: List[int] = field(default_factory=list)
    warnings: List[ExtractionWarning] = field(default_factory=list)
    metadata: Optional[DocumentMetadata] = None
    error_message: Optional[str] = None

    def finalize_status(self) -> None:
        """Determines final status based on errors and warnings."""
        if self.error_message:
            self.status = ExtractionStatus.FAILED.value
        elif len(self.warnings) > 0:
            self.status = ExtractionStatus.COMPLETED_WITH_WARNINGS.value
        else:
            self.status = ExtractionStatus.COMPLETED.value

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "title": self.title,
            "format": self.format,
            "status": self.status,
            "normalized_text": self.normalized_text,
            "blocks": [b.to_dict() for b in self.blocks],
            "headings": [h.to_dict() for h in self.headings],
            "tables": [t.to_dict() for t in self.tables],
            "code_blocks": [c.to_dict() for c in self.code_blocks],
            "page_references": self.page_references,
            "warnings": [w.to_dict() for w in self.warnings],
            "metadata": self.metadata.to_dict() if self.metadata else None,
            "error_message": self.error_message,
        }

    def to_json(self, indent: Optional[int] = None) -> str:
        return json.dumps(self.to_dict(), indent=indent)

