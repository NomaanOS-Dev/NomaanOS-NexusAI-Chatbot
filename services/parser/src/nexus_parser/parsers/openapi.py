"""OpenAPI / Swagger 2.0 / 3.x specification extractor (JSON & YAML)."""

import os
import json
import yaml
from typing import Optional, List, Dict, Any
from nexus_parser.base import BaseParser
from nexus_parser.models import (
    NormalizedDocument,
    DocumentFormat,
    ContentBlock,
    BlockType,
    HeadingItem,
    ExtractionWarning,
)


class OpenApiParser(BaseParser):
    format = DocumentFormat.OPENAPI

    def can_parse(self, filename: str, mime_type: Optional[str] = None) -> bool:
        lower = filename.lower()
        if any(term in lower for term in ["openapi", "swagger", "api-spec", "api_spec"]):
            if lower.endswith((".json", ".yaml", ".yml")):
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
        warnings: List[ExtractionWarning] = []
        if encoding_warning:
            warnings.append(encoding_warning)

        # Parse JSON or YAML
        spec: Dict[str, Any]
        try:
            if raw_text.strip().startswith("{"):
                spec = json.loads(raw_text)
            else:
                spec = yaml.safe_load(raw_text)
        except Exception as err:
            raise ValueError(f"Invalid OpenAPI format: Syntax error parsing specification: {str(err)}")

        if not isinstance(spec, dict):
            raise ValueError("Invalid OpenAPI specification: Root must be a JSON/YAML object.")

        # Check version: openapi 3.x or swagger 2.0
        version = spec.get("openapi") or spec.get("swagger")
        if not version:
            raise ValueError("Invalid OpenAPI specification: Missing required 'openapi' or 'swagger' version attribute.")

        str_version = str(version).strip()
        if not (str_version.startswith("3.") or str_version == "2.0"):
            raise ValueError(f"Unsupported OpenAPI version '{str_version}'. Supported versions: OpenAPI 3.0.x, 3.1.x, Swagger 2.0.")

        info = spec.get("info", {})
        title = info.get("title", "OpenAPI Specification")
        description = info.get("description", "")
        api_version = info.get("version", "1.0.0")

        blocks: List[ContentBlock] = []
        headings: List[HeadingItem] = []
        summary_text_parts: List[str] = [
            f"# {title} (v{api_version})",
            f"**Specification Version:** {str_version}",
        ]

        if description:
            summary_text_parts.append(f"**Description:** {description.strip()}")
            blocks.append(
                ContentBlock(
                    block_type=BlockType.PARAGRAPH.value,
                    content=description.strip(),
                )
            )

        headings.append(HeadingItem(title=title, level=1))

        # Security schemes
        components = spec.get("components", {})
        security_schemes = components.get("securitySchemes", {}) or spec.get("securityDefinitions", {})
        if security_schemes:
            sec_names = list(security_schemes.keys())
            summary_text_parts.append(f"**Security Schemes:** {', '.join(sec_names)}")
            blocks.append(
                ContentBlock(
                    block_type=BlockType.PARAGRAPH.value,
                    content=f"Security Schemes: {', '.join(sec_names)}",
                    metadata={"security_schemes": security_schemes},
                )
            )

        # Endpoints / Paths
        paths = spec.get("paths", {})
        if not isinstance(paths, dict) or len(paths) == 0:
            warnings.append(
                ExtractionWarning(
                    code="EMPTY_PATHS",
                    message="Specification contains no paths or operations.",
                    severity="warning",
                )
            )

        endpoint_count = 0

        for path_str, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue

            for method in ["get", "post", "put", "patch", "delete", "options", "head"]:
                op = path_item.get(method)
                if not isinstance(op, dict):
                    continue

                endpoint_count += 1
                method_upper = method.upper()
                op_id = op.get("operationId", f"{method}_{path_str.replace('/', '_')}")
                op_summary = op.get("summary") or op.get("description") or "No description provided."
                
                # Parameters
                params = op.get("parameters", [])
                param_strs = []
                for p in params:
                    if isinstance(p, dict):
                        p_name = p.get("name", "unnamed")
                        p_in = p.get("in", "query")
                        p_req = "required" if p.get("required") else "optional"
                        param_strs.append(f"{p_name} ({p_in}, {p_req})")

                # Responses
                responses = op.get("responses", {})
                resp_codes = list(responses.keys()) if isinstance(responses, dict) else []

                # Format human & RAG-friendly block
                op_text = f"### {method_upper} {path_str}\n"
                op_text += f"- **Summary:** {op_summary}\n"
                op_text += f"- **Operation ID:** `{op_id}`\n"
                if param_strs:
                    op_text += f"- **Parameters:** {', '.join(param_strs)}\n"
                if resp_codes:
                    op_text += f"- **Responses:** {', '.join(map(str, resp_codes))}\n"

                headings.append(HeadingItem(title=f"{method_upper} {path_str}", level=2))
                summary_text_parts.append(op_text.strip())

                blocks.append(
                    ContentBlock(
                        block_type=BlockType.API_PATH.value,
                        content=op_text.strip(),
                        metadata={
                            "method": method_upper,
                            "path": path_str,
                            "operationId": op_id,
                            "summary": op_summary,
                            "parameters": params,
                            "responses": resp_codes,
                        },
                    )
                )

        normalized_text = "\n\n".join(summary_text_parts).strip()

        doc = NormalizedDocument(
            title=title,
            format=self.format.value,
            normalized_text=normalized_text,
            blocks=blocks,
            headings=headings,
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

