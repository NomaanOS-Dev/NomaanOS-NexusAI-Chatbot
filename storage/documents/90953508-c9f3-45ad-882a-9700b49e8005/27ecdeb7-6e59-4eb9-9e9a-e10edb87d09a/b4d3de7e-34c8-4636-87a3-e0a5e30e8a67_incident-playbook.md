# Incident Response Playbook

## Detection and Triage
When an alert fires in Sentinel SOC, verify the incident telemetry.
Inspect firewall logs and egress traffic spikes before escalating to Level 2.

## Containment Procedures
Isolate affected host containers immediately.
Revoke OAuth refresh tokens and rotate database credentials within 15 minutes.

```bash
kubectl cordon node-prod-42
kubectl drain node-prod-42 --ignore-daemonsets
```

## Post-Incident Reporting
Draft an RCA within 24 hours. Submit postmortem analysis to the SecOps steering committee.