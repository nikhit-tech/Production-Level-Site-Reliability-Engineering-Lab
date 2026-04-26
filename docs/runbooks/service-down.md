# Runbook: Service Down

**Alerts:** `BackendServiceDown`, `WorkerServiceDown`  
**Severity:** Critical (backend), Warning (worker)

## Diagnosis

```bash
# 1. Check pod status
kubectl get pods -n ecommerce
kubectl describe pod <pod-name> -n ecommerce

# 2. Check recent events
kubectl get events -n ecommerce --sort-by='.lastTimestamp' | tail -20

# 3. Check logs
kubectl logs <pod-name> -n ecommerce --previous   # crashed pod
kubectl logs <pod-name> -n ecommerce              # current pod

# 4. Check if it's a CrashLoop
kubectl get pod <pod-name> -n ecommerce -o jsonpath='{.status.containerStatuses[0].restartCount}'

# 5. Check resource pressure
kubectl top pods -n ecommerce
kubectl top nodes
```

## Common Causes and Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CrashLoopBackOff` | App crash at startup | Check logs for `FATAL:` lines; likely missing env var |
| `OOMKilled` | Memory limit too low | `kubectl describe pod` → increase memory limit |
| `ImagePullBackOff` | Image not found | Check image tag and registry credentials |
| `Pending` | Insufficient cluster resources | Check node capacity; scale cluster |
| All pods restarting | Bad deployment | `kubectl rollout undo deployment/backend -n ecommerce` |

## Recovery

```bash
# Force a restart of all pods
kubectl rollout restart deployment/backend -n ecommerce

# Roll back to previous version
kubectl rollout undo deployment/backend -n ecommerce

# Scale up replicas temporarily
kubectl scale deployment/backend --replicas=5 -n ecommerce
```

## Escalation

- Backend down > 5 min: page backend team
- Backend down > 15 min: escalate to engineering manager
