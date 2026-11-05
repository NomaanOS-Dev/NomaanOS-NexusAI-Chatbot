"""Unit and integration tests for Nexus Ingestion Worker (Day 8)."""

import os
import uuid
import pytest
from unittest.mock import MagicMock, patch
from nexus_parser.worker import IngestionWorker


def test_worker_initialization():
    worker = IngestionWorker(
        worker_id="test-worker-01",
        poll_interval=1.5,
        lease_duration_seconds=30,
        api_url="http://localhost:4001",
        internal_key="test-key"
    )
    assert worker.worker_id == "test-worker-01"
    assert worker.poll_interval == 1.5
    assert worker.lease_duration_seconds == 30
    assert worker.api_url == "http://localhost:4001"
    assert worker.internal_key == "test-key"
    assert worker.stop_requested is False


def test_worker_graceful_shutdown():
    worker = IngestionWorker()
    assert worker.stop_requested is False
    worker._handle_signal(2, None)
    assert worker.stop_requested is True


def test_worker_claim_next_job_empty():
    """Verify worker returns None cleanly when queue is empty."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = None
    mock_cur.__enter__.return_value = mock_cur
    mock_conn.cursor.return_value = mock_cur
    mock_conn.__enter__.return_value = mock_conn

    with patch.object(IngestionWorker, "get_connection", return_value=mock_conn):
        worker = IngestionWorker()
        job = worker.claim_next_job()
        assert job is None
        mock_cur.execute.assert_called_once()


def test_worker_transient_failure_records_retry():
    """Verify that transient failures update job status to retry_waiting with backoff."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    # Simulates job with attempt 1 of 3
    mock_cur.fetchone.return_value = {"attempts": 1, "max_attempts": 3}
    mock_cur.__enter__.return_value = mock_cur
    mock_conn.cursor.return_value = mock_cur
    mock_conn.__enter__.return_value = mock_conn

    with patch.object(IngestionWorker, "get_connection", return_value=mock_conn):
        worker = IngestionWorker()
        job_id = str(uuid.uuid4())
        worker.record_failure(
            job_id=job_id,
            error_code="TRANSIENT_NETWORK",
            diagnostic_message="Temporary socket timeout",
            is_transient=True
        )

        assert mock_cur.execute.call_count == 2
        second_call_sql = mock_cur.execute.call_args_list[1][0][0]
        assert "status = 'retry_waiting'" in second_call_sql
        mock_conn.commit.assert_called_once()


def test_worker_permanent_failure_records_failed():
    """Verify that permanent failures transition immediately to failed without retry."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchone.return_value = {"attempts": 1, "max_attempts": 3}
    mock_cur.__enter__.return_value = mock_cur
    mock_conn.cursor.return_value = mock_cur
    mock_conn.__enter__.return_value = mock_conn

    with patch.object(IngestionWorker, "get_connection", return_value=mock_conn):
        worker = IngestionWorker()
        job_id = str(uuid.uuid4())
        worker.record_failure(
            job_id=job_id,
            error_code="PARSE_FAILURE",
            diagnostic_message="Corrupted file header",
            is_transient=False
        )

        assert mock_cur.execute.call_count == 2
        second_call_sql = mock_cur.execute.call_args_list[1][0][0]
        assert "status = 'failed'" in second_call_sql
        mock_conn.commit.assert_called_once()


def test_worker_heartbeat_renewal():
    """Verify heartbeat query renews lease duration for active worker."""
    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.rowcount = 1
    mock_cur.__enter__.return_value = mock_cur
    mock_conn.cursor.return_value = mock_cur
    mock_conn.__enter__.return_value = mock_conn

    with patch.object(IngestionWorker, "get_connection", return_value=mock_conn):
        worker = IngestionWorker()
        job_id = str(uuid.uuid4())
        renewed = worker.heartbeat(job_id)
        assert renewed is True
        mock_cur.execute.assert_called_once()
