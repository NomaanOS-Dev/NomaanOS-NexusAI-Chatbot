# Platform Architecture & Troubleshooting Runbook

## Error Codes and Networking
Error code ERR_NEXUS_CONN_REFUSED indicates that the upstream gRPC broker refused connection on port 9443 due to exhausted worker pool.
If elevated latencies occur on node-prod-42, initiate failover to node-prod-43.

## Authentication and Tokens
Endpoint POST /api/v1/auth/tokens/revoke terminates an active bearer session and blacklists the token across distributed Redis nodes within 50ms.
When client tokens expire after the 15-minute TTL, the auth service returns ERR_AUTH_EXPIRED.
For federated access, OAuth 2.1 with mTLS mutual authentication is strictly enforced.

## Infrastructure and Telemetry
All cluster nodes emit OpenTelemetry traces to hostname telemetry.internal.nomaanos.ai over mTLS port 4317 with mandatory TLS 1.3 ciphers.
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.