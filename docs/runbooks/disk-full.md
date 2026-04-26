# Runbook: Disk Space Low

**Alert:** `DiskSpaceLow`  
**Threshold:** < 15% free space  
**Severity:** Critical

## Diagnosis

```bash
# Which node is affected?
kubectl get nodes -o custom-columns='NAME:.metadata.name,STATUS:.status.conditions[-1].type'

# SSH to the affected node (or use a debug pod)
kubectl debug node/<node-name> -it --image=ubuntu

# Inside debug pod
df -h /host
du -sh /host/var/log/* | sort -rh | head -20
du -sh /host/var/lib/docker/* | sort -rh | head -10
```

## Common Causes and Fixes

### 1. Container logs filling disk
```bash
# Check log sizes
du -sh /var/log/containers/*

# Docker log cleanup (on the node)
docker system prune -f
journalctl --vacuum-size=500M
```

### 2. Postgres WAL accumulation
```bash
# Check PVC usage
kubectl exec -it postgres-0 -n ecommerce -- df -h /var/lib/postgresql/data

# Force checkpoint and clean WAL
kubectl exec -it postgres-0 -n ecommerce -- psql -U postgres -c "CHECKPOINT;"
kubectl exec -it postgres-0 -n ecommerce -- psql -U postgres -c "SELECT pg_walfile_name(pg_current_wal_lsn());"
```

### 3. Elasticsearch indices
```bash
kubectl exec -it <es-pod> -n logging -- curl -s localhost:9200/_cat/indices?v&s=store.size:desc | head -10
# Delete old indices
kubectl exec -it <es-pod> -n logging -- curl -XDELETE 'localhost:9200/ecommerce-logs-*'
```

## Prevention

- Configure log rotation: `--log-opt max-size=100m --log-opt max-file=3` in Docker
- Set Elasticsearch ILM policy to delete indices older than 30 days
- Monitor Postgres WAL retention with `wal_keep_size`
- Set up PVC monitoring alerts at 70% and 85% usage
