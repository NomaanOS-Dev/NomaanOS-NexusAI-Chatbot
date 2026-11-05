# Asynchronous Ingestion Spec

## Background Processing
Workers poll PostgreSQL for queued jobs using SKIP LOCKED.
Failed tasks with transient errors back off automatically.
