# Runbook: HighErrorRate

**Alert:** `HighErrorRate`  
**Severity:** Critical  
**SLO impact:** Yes — directly burns error budget

## Symptom

More than 5% of HTTP requests to the backend are returning 5xx responses, sustained for 5 minutes.

## Diagnosis

```bash
# 1. Check current error rate in Prometheus
curl -s 'http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status_code=~"5.."}[5m])/rate(http_requests_total[5m])'

# 2. See which routes are erroring
kubectl logs -l app=backend -n ecommerce --since=10m | grep '"status":5'

# 3. Check pod health
kubectl get pods -n ecommerce -l app=backend
kubectl describe pod <pod-name> -n ecommerce

# 4. Check recent deployments
kubectl rollout history deployment/backend -n ecommerce

# 5. Check database connectivity
kubectl exec -it deployment/backend -n ecommerce -- node -e "require('./src/database/connection').initDatabase().then(() => console.log('DB OK'))"
```

## Remediation

| Cause | Fix |
|-------|-----|
| Bad deployment | `kubectl rollout undo deployment/backend -n ecommerce` |
| DB connection pool exhausted | Scale backend replicas or increase pool size |
| Downstream dependency down | Check Redis/Postgres pods; see [service-down runbook](./service-down.md) |
| OOM kills | `kubectl top pods -n ecommerce`; adjust memory limits |

## Escalation

- Page on-call DBA if database errors > 10m
- Page backend team lead if rollback doesn't resolve within 15m
