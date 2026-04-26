# Chaos Engineering Experiments

Each experiment follows the same structure:
**Hypothesis → Blast Radius → Inject → Observe → Rollback → Post-experiment**

All experiments should be run in staging first. Production experiments require on-call engineer approval and a maintenance window notification.

---

## Experiment 1: Database Connection Loss

**Hypothesis:** When Postgres becomes unavailable, the backend returns 503 for database-dependent endpoints within 30 seconds, while cached reads (products) continue serving for up to 300 seconds (cache TTL). The `DatabaseScrapeFailing` alert fires within 2 minutes.

**Blast Radius:** All write operations, uncached reads. Cached product reads unaffected.

**Inject:**
```bash
kubectl scale statefulset postgres --replicas=0 -n ecommerce
```

**Observe:**
- `GET /health` → still 200 (no DB dependency)
- `GET /api/health/readiness` → 503 within 30s
- `GET /api/products` → 200 from cache (up to 300s)
- `POST /api/orders` → 503 immediately
- Prometheus: `health_check_status{service="database"}` drops to 0
- Alert `DatabaseScrapeFailing` fires within 2 minutes
- Grafana SLO dashboard: error budget burn visible

**Rollback:**
```bash
kubectl scale statefulset postgres --replicas=1 -n ecommerce
kubectl wait --for=condition=ready pod/postgres-0 -n ecommerce --timeout=120s
```

**Success criteria:** 
- Cache serves reads during outage
- Error rate < 50% (only write operations fail)
- Alert fires within SLO window
- Full recovery < 2 minutes after rollback

---

## Experiment 2: Pod Crash Loop

**Hypothesis:** When a backend pod enters CrashLoopBackOff, the HPA and PDB ensure at least 2 pods remain healthy and traffic is rerouted without user-visible errors.

**Blast Radius:** ~1/3 of backend capacity during rollout.

**Inject:**
```bash
# Kill one pod
kubectl delete pod -l app=backend -n ecommerce --field-selector=status.phase=Running | head -1

# Or inject a crash via bad env
kubectl set env deployment/backend BAD_ENV_TO_CRASH=true -n ecommerce
```

**Observe:**
- `kubectl get pods -n ecommerce -w` — watch restart count
- `PodCrashLooping` alert fires within 5 minutes
- Error rate stays below SLO threshold (2 remaining pods handle load)
- HPA does NOT scale down below minReplicas=3

**Rollback:**
```bash
kubectl set env deployment/backend BAD_ENV_TO_CRASH- -n ecommerce
```

---

## Experiment 3: Redis Unavailability

**Hypothesis:** When Redis goes down, the backend falls back to direct database reads, latency increases but service remains available. Cache miss rate reaches 100%.

**Blast Radius:** Increased database load; latency degradation; session-based auth may fail.

**Inject:**
```bash
kubectl scale deployment redis --replicas=0 -n ecommerce
```

**Observe:**
- `GET /api/products` → still 200 (DB fallback)
- Latency: P95 should stay below 5s
- `GET /api/auth/verify` → 401 (Redis sessions unavailable)
- `RedisScrapeFailing` alert fires within 2 minutes
- Prometheus: `redis_response_time_seconds` metrics go stale

**Rollback:**
```bash
kubectl scale deployment redis --replicas=1 -n ecommerce
```

---

## Experiment 4: Memory Pressure

**Hypothesis:** When a backend pod approaches its memory limit, Kubernetes OOMKills it and restarts it within 60 seconds with no user impact due to rolling update configuration.

**Blast Radius:** One pod restart cycle.

**Inject:**
```bash
# Reduce memory limit temporarily
kubectl patch deployment backend -n ecommerce -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","resources":{"limits":{"memory":"64Mi"}}}]}}}}'
```

**Observe:**
- Pod eventually OOMKilled (`kubectl describe pod | grep OOMKilled`)
- `HighMemoryUsage` alert fires
- Pod restarts and becomes Ready
- No sustained user-visible errors (other pods absorb traffic)

**Rollback:**
```bash
kubectl patch deployment backend -n ecommerce -p '{"spec":{"template":{"spec":{"containers":[{"name":"backend","resources":{"limits":{"memory":"512Mi"}}}]}}}}'
```

---

## Experiment 5: Network Partition (NetworkPolicy test)

**Hypothesis:** If the NetworkPolicy is working correctly, direct connections from a non-whitelisted pod to Postgres are rejected.

**Blast Radius:** None — read-only test.

**Inject:**
```bash
# Try connecting to Postgres from a non-backend pod
kubectl run nettest --image=postgres:15-alpine -n ecommerce --rm -it -- \
  psql -h postgres-service -U postgres -d ecommerce
```

**Expected outcome:** Connection refused or timeout (NetworkPolicy enforced).

**Success criteria:** Command times out; connection is not established.

---

## Running Experiments Safely

1. **Always have a rollback ready** before injecting.
2. **Monitor the SLO dashboard** throughout the experiment.
3. **Set a time limit** — if the experiment runs more than 10 minutes without resolution, roll back.
4. **Document results** in a post-experiment note: what happened, what surprised you, what to improve.
5. **Never run multiple experiments simultaneously** — isolate variables.
