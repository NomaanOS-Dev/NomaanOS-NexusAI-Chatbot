
# Sentinel Incident Response Playbook
## Section 1: Triage Guidelines
When a critical SSH brute-force alert fires, immediately isolate the affected host.
1. Check authentication logs in /var/log/auth.log.
2. Verify rate-limiting firewall rules on port 22.
3. Notify the on-call Security Operations Lead.

## Section 2: Containment
Execute automated quarantine scripts to terminate unauthorized sessions.
      