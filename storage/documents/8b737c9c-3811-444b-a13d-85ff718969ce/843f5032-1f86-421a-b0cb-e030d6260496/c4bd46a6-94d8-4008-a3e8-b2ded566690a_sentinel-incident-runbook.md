# Sentinel Incident & SRE Runbook

## Authentication Protocols & Error Codes
When client tokens expire after the 15-minute TTL, the auth service returns `ERR_AUTH_EXPIRED`.
Inspect authentication failures at endpoint `/api/v1/auth/login`.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.

## Cluster Node Topology & Incident Failover
Host `node-prod-42` operates as the primary ingress revalidation proxy.
If elevated latencies occur on `node-prod-42`, initiate failover to `node-prod-43`.
The Kafka broker is reachable at `kafka-broker-01.internal`.