# Runbook: High Latency

**Alerts:** `HighLatencyP95`, `HighLatencyP99`  
**Thresholds:** P95 > 2s, P99 > 1s

## Diagnosis

```bash
# Current latency percentiles
curl -s 'http://prometheus:9090/api/v1/query?query=job:http_request_duration_p95:rate5m'
curl -s 'http://prometheus:9090/api/v1/query?query=job:http_request_duration_p99:rate5m'

# Which routes are slowest?
kubectl logs -l app=backend -n ecommerce --since=10m | jq 'select(.duration > 1) | {url, duration, status}'

# Database slow queries
kubectl exec -it postgres-0 -n ecommerce -- psql -U postgres ecommerce -c "
  SELECT query, calls, total_exec_time/calls AS avg_ms, rows
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC LIMIT 10;"

# Redis latency
kubectl exec -it deployment/backend -n ecommerce -- redis-cli -h redis-service --latency
```

## Common Causes and Fixes

| Cause | Signal | Fix |
|-------|--------|-----|
| Missing DB index | Slow query in pg_stat_statements | `EXPLAIN ANALYZE` the query; add index |
| Redis unavailable | Cache miss rate 100% | Check Redis pod; verify REDIS_PASSWORD |
| Connection pool exhausted | `pool.waitingCount > 0` | Scale backend replicas |
| N+1 queries | Many fast queries in logs | Optimise query in code; add JOIN |
| Downstream API slow | Trace shows external call | Add timeout and circuit breaker |

## Quick Mitigations

```bash
# Scale backend to reduce per-pod load
kubectl scale deployment/backend --replicas=6 -n ecommerce

# Restart backend if pool is stuck
kubectl rollout restart deployment/backend -n ecommerce

# Check connection pool health
curl http://localhost:8080/api/health/metrics | jq '.database.pool_stats'
```
