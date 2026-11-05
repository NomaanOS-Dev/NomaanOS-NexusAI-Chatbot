"""Pytest configuration and synthetic fixtures for Nexus AI parser tests."""

import sys
import os
import pytest

# Ensure nexus_parser is in sys.path
SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


@pytest.fixture
def synthetic_txt_bytes():
    return b"""NomaanOS Nexus AI Platform Architecture

NomaanOS Nexus AI is a unified intelligence engine providing modular chat widgets,
knowledge spaces, and retrieval-augmented generation.

Features:
- Multi-tenant isolation
- Grounded citations
- Layout-aware chunking
"""


@pytest.fixture
def synthetic_md_bytes():
    return b"""# Incident Response Guide

Enterprise threat monitoring and triage runbook.

## Step 1: Containment
Isolate compromised hosts immediately.

```bash
iptables -A INPUT -s 192.168.1.100 -j DROP
```

## Step 2: Severity Matrix
| Level | Response SLA | Escalation |
|-------|--------------|------------|
| Critical | 15 mins | CISO |
| High | 1 hour | Lead Analyst |
| Low | 24 hours | Ticket Queue |

* Follow all chain-of-custody protocols.
* Preserve memory dumps.
"""


@pytest.fixture
def synthetic_html_bytes():
    return b"""<!DOCTYPE html>
<html>
<head>
    <title>Cloud Deployment Runbook</title>
    <style>body { color: red; }</style>
    <script>alert('Malicious Code Execution Attempt');</script>
</head>
<body>
    <h1>Production Cluster Operations</h1>
    <p>This runbook outlines emergency recovery procedures for PostgreSQL 16 replicas.</p>
    <h2>Health Checks</h2>
    <ul>
        <li>Verify container status on port 5434.</li>
        <li>Check disk volume utilization.</li>
    </ul>
    <table>
        <tr><th>Metric</th><th>Threshold</th></tr>
        <tr><td>CPU Usage</td><td>85%</td></tr>
        <tr><td>Memory Saturation</td><td>90%</td></tr>
    </table>
    <script src="https://evil.example.com/exploit.js"></script>
</body>
</html>
"""


@pytest.fixture
def synthetic_openapi_json_bytes():
    return b"""{
  "openapi": "3.0.3",
  "info": {
    "title": "Sentinel Telemetry API",
    "version": "1.0.0",
    "description": "High-throughput SIEM event ingestion endpoints"
  },
  "paths": {
    "/api/v1/telemetry/events": {
      "post": {
        "summary": "Ingest Batch Events",
        "operationId": "ingestBatchEvents",
        "parameters": [
          {
            "name": "X-API-Key",
            "in": "header",
            "required": true
          }
        ],
        "responses": {
          "201": {
            "description": "Events accepted for processing"
          },
          "400": {
            "description": "Invalid event schema"
          }
        }
      }
    }
  }
}"""


@pytest.fixture
def synthetic_json_doc_bytes():
    return b"""{
  "title": "Cluster Configuration",
  "environment": "production",
  "nodes": [
    { "name": "node-alpha", "role": "primary", "ip": "10.0.0.1" },
    { "name": "node-beta", "role": "replica", "ip": "10.0.0.2" }
  ],
  "monitoring": {
    "enabled": true,
    "metricsPort": 9090
  }
}"""

