# Sentinel SOC Incident & API Response Guide

## Authentication Failures & Token Expiration
When clients receive HTTP 401 with error code ERR_AUTH_EXPIRED, the JWT access token has passed its expiry.
Inspect the authorization header and verify rotation at /api/v1/auth/refresh.
For login issues, test POST /api/v1/auth/login directly against the identity provider.

## Kubernetes Node Drainage and OOMKilled Errors
When pod container exit code 137 occurs, Linux cgroups terminated the process due to OOMKilled.
Isolate host cluster node node-prod-42 using:
```bash
kubectl cordon node-prod-42
kubectl drain node-prod-42 --ignore-daemonsets
```
Check container memory limits in the deployment manifest before uncordoning.