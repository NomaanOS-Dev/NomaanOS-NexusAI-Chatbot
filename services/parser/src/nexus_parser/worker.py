"""NomaanOS Nexus AI - Durable Python Ingestion Worker (Day 8).

Processes asynchronous document ingestion, source synchronization, and connector jobs.
Features:
- PostgreSQL-backed atomic claiming with SELECT ... FOR UPDATE SKIP LOCKED.
- Leases and automatic recovery of stale / timed-out jobs.
- Exponential backoff with jitter for transient failures.
- Integration with Day 7 structure-aware chunking & versioning via internal authenticated API.
- Graceful shutdown on SIGINT/SIGTERM.
"""

import os
import sys
import time
import json
import uuid
import signal
import random
import logging
from typing import Optional, Dict, Any

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None

try:
    import requests
except ImportError:
    requests = None

from nexus_parser.registry import parse_document
from nexus_parser.models import ExtractionStatus

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s", "level":"%(levelname)s", "name":"%(name)s", "msg":"%(message)s"}'
)
logger = logging.getLogger("nexus-worker")


class IngestionWorker:
    def __init__(
        self,
        db_url: Optional[str] = None,
        api_url: Optional[str] = None,
        internal_key: Optional[str] = None,
        worker_id: Optional[str] = None,
        poll_interval: float = 2.0,
        lease_duration_seconds: int = 60,
    ):
        if not psycopg:
            raise RuntimeError("psycopg package is required for IngestionWorker. Install with 'pip install psycopg[binary]'.")

        self.db_url = db_url or os.getenv("DATABASE_URL") or "postgresql://Nomaan-Nexus:Chatbot-Password@127.0.0.1:5434/nomaanos_nexus_ai"
        # Ensure 127.0.0.1 is used instead of localhost on Windows
        if "@localhost:" in self.db_url:
            self.db_url = self.db_url.replace("@localhost:", "@127.0.0.1:")

        self.api_url = (api_url or os.getenv("API_URL") or "http://127.0.0.1:4001").rstrip("/")
        self.internal_key = internal_key or os.getenv("INTERNAL_API_KEY") or "nexus_internal_worker_secret_2026"
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self.poll_interval = poll_interval
        self.lease_duration_seconds = lease_duration_seconds
        self.stop_requested = False

        # Register signal handlers
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    def _handle_signal(self, signum, frame):
        logger.info(f"Shutdown signal ({signum}) received. Finishing active jobs...")
        self.stop_requested = True

    def get_connection(self):
        return psycopg.connect(self.db_url, row_factory=dict_row, connect_timeout=5)

    def claim_next_job(self) -> Optional[Dict[str, Any]]:
        """Atomically claim the next eligible job using FOR UPDATE SKIP LOCKED."""
        claim_sql = """
        UPDATE ingestion_jobs
        SET
          status = 'processing',
          locked_by = %(worker_id)s,
          locked_at = NOW(),
          lease_expires_at = NOW() + (%(lease_secs)s || ' seconds')::interval,
          started_at = COALESCE(started_at, NOW()),
          attempts = attempts + 1,
          updated_at = NOW()
        WHERE id = (
          SELECT id FROM ingestion_jobs
          WHERE (
            (status IN ('queued', 'retry_waiting') AND scheduled_at <= NOW())
            OR
            (status = 'processing' AND lease_expires_at < NOW())
          )
          ORDER BY scheduled_at ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *;
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(claim_sql, {"worker_id": self.worker_id, "lease_secs": self.lease_duration_seconds})
                row = cur.fetchone()
                conn.commit()
                if row is None:
                    return None
                return dict(row) if isinstance(row, dict) else row

    def heartbeat(self, job_id: str) -> bool:
        """Extends worker lease for long running operations."""
        heartbeat_sql = """
        UPDATE ingestion_jobs
        SET lease_expires_at = NOW() + (%(lease_secs)s || ' seconds')::interval,
            updated_at = NOW()
        WHERE id = %(job_id)s AND locked_by = %(worker_id)s AND status = 'processing';
        """
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(heartbeat_sql, {
                    "lease_secs": self.lease_duration_seconds,
                    "job_id": job_id,
                    "worker_id": self.worker_id
                })
                conn.commit()
                rowcount = cur.rowcount
                if isinstance(rowcount, int):
                    return rowcount > 0
                return bool(rowcount)

    def record_failure(
        self,
        job_id: str,
        error_code: str,
        diagnostic_message: str,
        is_transient: bool = False
    ) -> None:
        """Transitions job to retry_waiting (with exponential backoff) or permanent failed."""
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT attempts, max_attempts FROM ingestion_jobs WHERE id = %s;", (job_id,))
                row = cur.fetchone()
                if not row:
                    return

                attempts = int(row["attempts"]) if isinstance(row, dict) and "attempts" in row else 1
                max_attempts = int(row["max_attempts"]) if isinstance(row, dict) and "max_attempts" in row else 3
                should_retry = is_transient and attempts < max_attempts

                if should_retry:
                    jitter = random.uniform(0.5, 2.0)
                    delay_seconds = min(300, max(2, int((2 ** attempts) * 2 + jitter)))
                    retry_sql = """
                    UPDATE ingestion_jobs
                    SET status = 'retry_waiting',
                        scheduled_at = NOW() + (%s || ' seconds')::interval,
                        locked_by = NULL,
                        lease_expires_at = NULL,
                        error_code = %s,
                        diagnostic_message = %s,
                        last_error = %s,
                        updated_at = NOW()
                    WHERE id = %s;
                    """
                    cur.execute(retry_sql, (delay_seconds, error_code, diagnostic_message, diagnostic_message, job_id))
                    logger.warning(f"Job {job_id} scheduled for retry in {delay_seconds}s (Attempt {attempts}/{max_attempts}): {diagnostic_message}")
                else:
                    fail_sql = """
                    UPDATE ingestion_jobs
                    SET status = 'failed',
                        completed_at = NOW(),
                        locked_by = NULL,
                        lease_expires_at = NULL,
                        error_code = %s,
                        diagnostic_message = %s,
                        last_error = %s,
                        updated_at = NOW()
                    WHERE id = %s;
                    """
                    cur.execute(fail_sql, (error_code, diagnostic_message, diagnostic_message, job_id))
                    logger.error(f"Job {job_id} failed permanently ({error_code}): {diagnostic_message}")
                conn.commit()

    def process_job(self, job: Dict[str, Any]) -> bool:
        """Processes a claimed ingestion or synchronization job."""
        job_id = str(job["id"])
        job_type = job.get("job_type", "document_ingest")
        workspace_id = str(job["workspace_id"])
        source_id = str(job["source_id"]) if job.get("source_id") else None
        knowledge_space_id = str(job["knowledge_space_id"]) if job.get("knowledge_space_id") else None

        logger.info(f"Processing job {job_id} (Type: {job_type}, Workspace: {workspace_id})")

        try:
            # 1. Fetch document source details if source_id is present
            storage_path = None
            filename = "document"
            mime_type = "application/octet-stream"
            title = None
            custom_metadata = {}

            if source_id:
                with self.get_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT title, filename, mime_type, storage_path, knowledge_space_id, metadata FROM document_sources WHERE id = %s AND workspace_id = %s;",
                            (source_id, workspace_id)
                        )
                        src_row = cur.fetchone()
                        if src_row:
                            storage_path = src_row.get("storage_path")
                            filename = src_row.get("filename") or filename
                            mime_type = src_row.get("mime_type") or mime_type
                            title = src_row.get("title")
                            custom_metadata = src_row.get("metadata") or {}
                            if not knowledge_space_id:
                                knowledge_space_id = str(src_row.get("knowledge_space_id"))

            payload = job.get("payload") or {}
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except Exception:
                    payload = {}

            # Override with payload if supplied
            if payload.get("storagePath"):
                storage_path = payload["storagePath"]
            if payload.get("filename"):
                filename = payload["filename"]
            if payload.get("mimeType"):
                mime_type = payload["mimeType"]
            if payload.get("title"):
                title = payload["title"]

            # 2. Locate and read document content
            content_bytes = b""
            if storage_path:
                # Resolve relative or absolute path
                candidate_paths = [
                    storage_path,
                    os.path.join(os.getcwd(), storage_path),
                    os.path.join(os.getcwd(), "storage", storage_path),
                    os.path.abspath(storage_path)
                ]
                found_path = next((p for p in candidate_paths if os.path.exists(p) and os.path.isfile(p)), None)
                if found_path:
                    with open(found_path, "rb") as f:
                        content_bytes = f.read()
                elif payload.get("rawContent"):
                    content_bytes = payload["rawContent"].encode("utf-8")
                else:
                    self.record_failure(job_id, "STORAGE_FILE_NOT_FOUND", f"Stored file at '{storage_path}' could not be located.", is_transient=False)
                    return False
            elif payload.get("rawContent"):
                content_bytes = payload["rawContent"].encode("utf-8")
            else:
                self.record_failure(job_id, "EMPTY_PAYLOAD", "No storage path or content provided for document ingestion.", is_transient=False)
                return False

            # Heartbeat check
            self.heartbeat(job_id)

            # 3. Execute Document Extraction using nexus-parser
            doc = parse_document(content_bytes, filename, mime_type)
            if doc.status == ExtractionStatus.FAILED.value:
                self.record_failure(job_id, "PARSE_FAILURE", doc.error_message or "Extraction failed", is_transient=False)
                return False

            final_title = title or doc.title or filename
            extracted_dict = doc.to_dict()
            doc_sha256 = doc.metadata.sha256 if doc.metadata else ""

            # 4. Commit to Day 7 Structure-Aware Chunker & Versioning via Internal API
            if not requests:
                raise RuntimeError("requests package is required to communicate with API server.")

            commit_body = {
                "jobId": job_id,
                "workerId": self.worker_id,
                "sourceId": source_id,
                "workspaceId": workspace_id,
                "knowledgeSpaceId": knowledge_space_id,
                "title": final_title,
                "extractedData": extracted_dict,
                "normalizedText": doc.normalized_text,
                "sha256": doc_sha256,
                "warnings": [w.to_dict() if hasattr(w, "to_dict") else w for w in doc.warnings],
                "customMetadata": custom_metadata,
            }

            try:
                resp = requests.post(
                    f"{self.api_url}/api/v1/internal/ingestion/commit",
                    json=commit_body,
                    headers={"x-internal-key": self.internal_key},
                    timeout=45
                )

                if resp.status_code == 200:
                    logger.info(f"Job {job_id} successfully committed chunks and document version.")
                    return True
                elif resp.status_code in (429, 502, 503, 504):
                    self.record_failure(
                        job_id,
                        "TRANSIENT_API_ERROR",
                        f"Internal API returned transient status {resp.status_code}: {resp.text[:300]}",
                        is_transient=True
                    )
                    return False
                else:
                    self.record_failure(
                        job_id,
                        "INTERNAL_COMMIT_ERROR",
                        f"Internal API rejected commit ({resp.status_code}): {resp.text[:300]}",
                        is_transient=False
                    )
                    return False
            except (requests.ConnectionError, requests.Timeout) as net_err:
                self.record_failure(
                    job_id,
                    "TRANSIENT_NETWORK",
                    f"Connection to API server failed: {str(net_err)[:300]}",
                    is_transient=True
                )
                return False

        except Exception as ex:
            logger.exception(f"Unhandled exception while processing job {job_id}")
            self.record_failure(job_id, "UNHANDLED_WORKER_EXCEPTION", str(ex)[:400], is_transient=True)
            return False

    def run_once(self) -> bool:
        """Claims and processes a single job if one is available."""
        job = self.claim_next_job()
        if not job:
            return False
        return self.process_job(job)

    def run_loop(self):
        """Continuous execution loop with polling interval."""
        logger.info(f"Nexus Ingestion Worker [{self.worker_id}] started. Polling every {self.poll_interval}s...")
        while not self.stop_requested:
            try:
                processed = self.run_once()
                if not processed:
                    time.sleep(self.poll_interval)
            except Exception as ex:
                logger.error(f"Error in worker main loop: {ex}")
                time.sleep(self.poll_interval)
        logger.info(f"Nexus Ingestion Worker [{self.worker_id}] terminated cleanly.")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="NomaanOS Nexus AI Python Background Worker")
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit")
    parser.add_argument("--interval", type=float, default=2.0, help="Polling interval in seconds")
    parser.add_argument("--lease", type=int, default=60, help="Lease duration in seconds")
    parser.add_argument("--worker-id", type=str, default=None, help="Explicit worker ID identifier")
    args = parser.parse_args()

    worker = IngestionWorker(
        worker_id=args.worker_id,
        poll_interval=args.interval,
        lease_duration_seconds=args.lease
    )

    if args.once:
        processed = worker.run_once()
        print(json.dumps({"workerId": worker.worker_id, "processed": processed}))
        sys.exit(0 if processed else 1)
    else:
        worker.run_loop()


if __name__ == "__main__":
    main()
