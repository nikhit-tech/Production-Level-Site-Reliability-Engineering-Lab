# Runbook: Pod Crash Loop

**Alert:** `PodCrashLooping`  
**Severity:** Warning

## Diagnosis

```bash
# Which pods are restarting?
kubectl get pods -n ecommerce | grep -v Running

# How many restarts?
kubectl get pods -n ecommerce -o custom-columns='NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount'

# What is the exit reason?
kubectl describe pod <pod-name> -n ecommerce | grep -A5 "Last State"

# Previous container logs (often contains the crash reason)
kubectl logs <pod-name> -n ecommerce --previous

# Check for OOM
kubectl describe pod <pod-name> -n ecommerce | grep -i "oomkilled\|out of memory"
```

## Common Causes

| Exit Code | Meaning | Fix |
|-----------|---------|-----|
| 1 | App error / unhandled exception | Check logs for stack trace |
| 137 | OOMKilled | Increase memory limit |
| 143 | SIGTERM not handled in time | Verify gracefulShutdown handles SIGTERM |
| 255 | Missing env var (app exited with code 1) | Check `FATAL:` log lines |

## Fix

```bash
# View and edit the deployment to fix env/resources
kubectl edit deployment <name> -n ecommerce

# Immediately after fixing, watch the rollout
kubectl rollout status deployment/<name> -n ecommerce -w
```
