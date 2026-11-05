# Database Failover Runbook

## PostgreSQL Replication Lag
When replication lag exceeds 500MB, monitor pg_stat_replication.
Execute failover script:
```bash
nexusctl db failover --cluster=prod-db-primary
```
Verify WAL replay on replica nodes.