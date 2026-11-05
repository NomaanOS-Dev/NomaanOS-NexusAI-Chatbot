# Sentinel SRE Runbook (v2)

## Cluster Topology & Networking
The Kafka broker is reachable at kafka-broker-01.internal on port 9092.
Host node-prod-42 operates as the primary ingress proxy with node-prod-43 as warm standby.

## Critical Error Codes
Error code ERR_NEXUS_CONN_REFUSED indicates that gRPC broker connection dropped on port 9443.
Mitigation: Execute 'nexusctl pool expand --workers=64'.
