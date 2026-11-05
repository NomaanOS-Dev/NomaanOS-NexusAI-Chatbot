# Incident Response Playbook (v2)

## Detection and Triage
Updated triage: Sentinel SOC now routes alerts to AI Copilot first.
Copilot auto-triages alerts against historical false positives.

## Containment Procedures
Automated network quarantine is now enabled.
Revoke OAuth refresh tokens and rotate DB credentials within 5 minutes.

```bash
nexusctl secops isolate-host --cluster=prod-us --node=node-prod-42
```

## Recovery and Verification
Verify cluster integrity and run vulnerability scanning before uncordoning.

## Post-Incident Reporting
All RCAs must be generated via the automated Postmortem Workspace.