# NomaanOS Nexus AI — Knowledge Sources, Secure Upload & Extraction Pipeline (Day 6)

**Specification Version:** 1.0.0  
**Status:** Implemented & Verified  
**Milestone:** Day 6 (Milestone 3 Foundation)

---

## 1. Overview & Conceptual Architecture

Day 6 establishes the enterprise document ingestion foundation for NomaanOS Nexus AI. It provides an extensible, layout-aware document extraction service, private tenant-isolated storage, and version-tracked metadata persistence.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           Client / Administrator                               │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ POST multipart/form-data
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│               Nexus AI Core API Server (Node.js 20+ / Express)                │
│  - RBAC & Tenant Scoping (Analyst+ upload permission)                          │
│  - File Size & MIME Signature Validation                                       │
│  - Filename Traversal Sanitization                                             │
│  - Private Storage: storage/documents/<workspaceId>/<sourceId>/               │
│  - Audit Logging: document_source_registered, document_source_deleted          │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ Subprocess Invocation (JSON Protocol)
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│              Nexus Document Parser Service (Python 3.12 / nexus-parser)        │
│  ┌───────────────────────┬───────────────────────┬──────────────────────────┐  │
│  │    PlainTextParser    │    MarkdownParser     │       HtmlParser         │  │
│  ├───────────────────────┼───────────────────────┼──────────────────────────┤  │
│  │       PdfParser       │     OpenApiParser     │       JsonParser         │  │
│  └───────────────────────┴───────────────────────┴──────────────────────────┘  │
│  - Normalized Common Document Schema (headings, tables, code blocks, warnings) │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ Structured JSON Result
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                  PostgreSQL 16 + pgvector Database                             │
│  - document_sources (status, extracted_text, extracted_data, warnings)         │
│  - document_versions (version_number, sha256, raw_content, extracted_data)     │
│  - knowledge_spaces & assistant_knowledge_spaces                               │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Document Processing Lifecycle & Status State Machine

Each document transitions through a deterministic state machine:

```
[ Upload Attempt ]
       │
       ├──► File validation failure (Empty / Oversized / Spoofed MIME) ──► HTTP 400 / 413 / 415 (Rejected before persistence)
       │
       ▼
 [ status: 'uploaded' ] (Raw bytes written to private storage, metadata in DB)
       │
       ▼
 [ status: 'processing' ] (Parser spawned)
       │
       ├──► Unrecoverable syntax/corrupt format ──► [ status: 'failed' ] (errorMessage persisted)
       │
       ├──► Extracted with non-fatal anomalies ──► [ status: 'completed_with_warnings' ] (warnings array persisted)
       │
       └──► Clean extraction ──────────────────► [ status: 'completed' ]
```

### Status Definitions
| Status | Meaning |
|---|---|
| `uploaded` | File successfully stored in private storage; queued or pending extraction. |
| `processing` | Parser is actively extracting text and analyzing document structure. |
| `completed` | Full extraction succeeded with zero non-fatal warnings. |
| `completed_with_warnings` | Extraction succeeded, but non-fatal warnings were recorded (e.g. blank pages requiring OCR, stripped `<script>` elements, truncated text exceeding safety thresholds). |
| `failed` | Extraction failed due to malformed syntax, password-protected PDF, or corrupt binary. Safe error message is recorded without exposing internal stack traces. |
| `archived` | Document source has been retired from active knowledge space retrieval. |

---

## 3. Supported File Formats & Extractors

| Format | Extensions | Extractor Class | Structure Preserved | Security Controls |
|---|---|---|---|---|
| **Plain Text** | `.txt`, `.log`, `.cfg`, `.ini` | `PlainTextParser` | Paragraphs, line-ending normalization (`\n`). | Fallback decoding, null-byte stripping, 10M char safety limit. |
| **Markdown** | `.md`, `.markdown` | `MarkdownParser` | `#` to `######` heading levels, fenced code blocks with language, markdown tables (`\| col \|`), bullet and numbered lists. | Hierarchy preserved without flattening; raw HTML tags escaped. |
| **HTML** | `.html`, `.htm`, `.xhtml` | `HtmlParser` | Title, `<h1>`-`<h6>` headings, paragraphs, lists, `<table>` data. | Pure Python `html.parser`. **Zero execution**. `<script>`, `<style>`, `<iframe>`, `<svg>` tags stripped with warning recorded. |
| **PDF** | `.pdf` | `PdfParser` | Page-indexed text (`page 1`, `page 2`), page references, paragraph splits. | Header magic byte check (`%PDF-`), detection of encrypted/password-protected PDFs. Empty/scanned pages record OCR warning. |
| **OpenAPI** | `.json`, `.yaml`, `.yml` | `OpenApiParser` | API title, paths, HTTP methods (GET/POST/...), operation summaries, parameters, response codes, security schemes. | Strict version validation (OpenAPI 3.x, Swagger 2.0). Formats into RAG-friendly structured endpoint blocks. |
| **Approved JSON** | `.json` | `JsonParser` | Hierarchical key-value pairs, nested objects, array items, section titles. | Strict JSON decode, recursion bomb protection (max 20 nesting levels), memory limits. |

---

## 4. API Specification & Endpoints

### 4.1 Upload & Register Document Source
- **Route 1**: `POST /api/v1/workspaces/:workspaceId/knowledge-spaces/:knowledgeSpaceId/sources`
- **Route 2**: `POST /api/v1/knowledge-sources` (with `knowledgeSpaceId` in form data or URL)
- **Content-Type**: `multipart/form-data`
- **Permissions**: Workspace `analyst`, `admin`, or `owner`.
- **Form Fields**:
  - `file`: Raw binary document (`.txt`, `.md`, `.html`, `.pdf`, `.json`, `.yaml`, `.yml`) (Max 15 MiB).
  - `title`: String (Optional; defaults to parsed heading or sanitized filename).
  - `assistantId`: UUID (Optional; links source to an assistant in the same workspace).
  - `metadata`: JSON string of custom metadata attributes.
- **Response (201 Created)**:
  ```json
  {
    "status": "ok",
    "source": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "workspaceId": "00000000-0000-0000-0000-000000000002",
      "knowledgeSpaceId": "00000000-0000-0000-0000-000000000101",
      "assistantId": "4f9d1462-8321-4f11-8be8-2d83ba32d1e0",
      "title": "Incident Response Runbook",
      "filename": "runbook.md",
      "mimeType": "text/markdown",
      "fileSizeBytes": 451200,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "status": "completed",
      "warnings": [],
      "errorMessage": null,
      "versionNumber": 1,
      "createdAt": "2026-10-31T12:00:00.000Z",
      "updatedAt": "2026-10-31T12:00:01.000Z"
    },
    "extraction": {
      "status": "completed",
      "warnings": [],
      "characterCount": 14200,
      "blocksCount": 24
    }
  }
  ```

### 4.2 List Knowledge Sources
- **Route**: `GET /api/v1/knowledge-sources`
- **Query Parameters**:
  - `knowledgeSpaceId` (UUID, optional)
  - `assistantId` (UUID, optional)
  - `status` (`completed`, `failed`, etc., optional)
- **Permissions**: Workspace `viewer+`.
- **Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "sources": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "workspaceId": "...",
        "knowledgeSpaceId": "...",
        "title": "Platform Architecture Guide",
        "filename": "architecture.txt",
        "status": "completed",
        "fileSizeBytes": 1024,
        "createdAt": "..."
      }
    ],
    "total": 1
  }
  ```

### 4.3 Get Knowledge Source Details
- **Route**: `GET /api/v1/knowledge-sources/:sourceId` (also aliased as `GET /api/v1/sources/:sourceId`)
- **Permissions**: Workspace `viewer+`.
- **Response (200 OK)**:
  ```json
  {
    "status": "ok",
    "source": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "workspaceId": "...",
      "title": "Sentinel Telemetry API",
      "filename": "openapi.yaml",
      "status": "completed",
      "extractedTextPreview": "...",
      "extractedData": {
        "format": "openapi",
        "blocks": [ ... ],
        "headings": [ ... ]
      },
      "warnings": [],
      "versions": [
        { "version_number": 1, "sha256": "...", "created_at": "..." }
      ]
    }
  }
  ```

### 4.4 Delete Knowledge Source
- **Route**: `DELETE /api/v1/knowledge-sources/:sourceId` (also aliased as `DELETE /api/v1/sources/:sourceId`)
- **Permissions**: Workspace `admin` or `owner`.
- **Behavior**: Atomically removes document source record, cascades deletion to versions and chunks, and unlinks private file from disk.

---

## 5. Security & Isolation Controls

1. **Private Storage Outside Public Roots**:
   - Files are stored under `storage/documents/<workspaceId>/<sourceId>/<uuid>_<cleanFilename>`.
   - The directory is strictly isolated from the Express public static router.
2. **Path Traversal Protection**:
   - Filenames pass through `sanitizeFilename()`, stripping `../`, `..\`, null bytes `\0`, and Windows forbidden characters.
3. **MIME & Extension Spoofing Protection**:
   - Verifies magic headers (e.g. `%PDF-` signature check for `.pdf`).
4. **Untrusted Evidence Boundary**:
   - Document contents are treated as untrusted text data. Embedded prompt injection attempts (e.g. `"Ignore previous instructions"`) are extracted purely as literal strings and never evaluated as configuration.
5. **Denial-of-Service & Resource Exhaustion Defense**:
   - Strict 15 MiB file size limit (`MAX_UPLOAD_FILE_BYTES`).
   - Rejection of 0-byte empty files.
   - 20-level recursion limit on JSON documents.
   - 10-million character safety buffer cap on parsed content.
   - 30-second subprocess execution timeout.

---

## 6. Local Setup & Testing Commands

### Run Python Parser Test Suite (22 Unit Tests)
```powershell
npm.cmd run test:parser
# or:
python -m pytest services/parser/tests
```

### Run Node.js API Test Suite (117 Integration Tests)
```powershell
npm.cmd run test:api
```

### Run Full System Test Suite (All 139 Tests)
```powershell
npm.cmd run test:all
```

