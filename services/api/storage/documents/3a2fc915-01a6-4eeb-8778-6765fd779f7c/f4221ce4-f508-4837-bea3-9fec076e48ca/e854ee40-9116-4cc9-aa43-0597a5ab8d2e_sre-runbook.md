# Sentinel SRE Runbook

## Cluster Topology & Networking
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.
Host node-prod-42 operates as the primary ingress revalidation proxy.
If elevated latencies occur on node-prod-42, initiate failover to node-prod-43.

## Critical Error Codes
Error code ERR_NEXUS_CONN_REFUSED indicates that the upstream gRPC broker refused connection on port 9443 due to exhausted worker pool.
When client tokens expire after the 15-minute TTL, the auth service returns ERR_AUTH_EXPIRED.

## Authentication Protocols
Endpoint POST /api/v1/auth/tokens/revoke terminates an active bearer session.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.
