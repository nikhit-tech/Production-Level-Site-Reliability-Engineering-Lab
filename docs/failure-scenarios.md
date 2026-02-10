# Failure Scenarios and Debugging Guide

## Overview

This document provides detailed failure scenarios, their symptoms, root causes, and step-by-step debugging procedures for common issues in the e-commerce platform.

## Scenario 1: Pod Crash Loop

### Symptoms
- Pod status shows `CrashLoopBackOff`
- Container repeatedly failing to start
- High restart count in pod status
- Service unavailable or degraded

### Metrics to Monitor
- `kube_pod_container_status_restarts_total`
- `kube_pod_status_phase{phase="Failed"}`
- Container exit codes
- Resource usage (CPU/Memory)

### Logs to Check
```bash
# Get pod logs
kubectl logs <pod-name> -n ecommerce --previous

# Get events
kubectl get events -n ecommerce --sort-by='.lastTimestamp'

# Check pod description
kubectl describe pod <pod-name> -n ecommerce
```

### Common Root Causes

#### 1.1 Resource Exhaustion
**Symptoms:**
- OOMKilled events
- Memory limit exceeded
- CPU throttling

**Debugging Steps:**
```bash
# Check resource usage
kubectl top pods -n ecommerce

# Check resource limits
kubectl describe pod <pod-name> -n ecommerce | grep -A 10 "Limits:"

# View OOM events
kubectl get events -n ecommerce | grep OOMKilled
```

**Fix:**
```yaml
# Increase resource limits in deployment
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "1Gi"
    cpu: "500m"
```

#### 1.2 Configuration Error
**Symptoms:**
- Invalid environment variables
- Missing required files
- Incorrect startup parameters

**Debugging Steps:**
```bash
# Check environment variables
kubectl exec <pod-name> -n ecommerce -- env | grep -E "(DB_|REDIS_|JWT_)"

# Check mounted files
kubectl exec <pod-name> -n ecommerce -- ls -la /app/config

# Check startup script
kubectl exec <pod-name> -n ecommerce -- cat /app/start.sh
```

**Fix:**
```bash
# Update ConfigMap or Secret
kubectl edit configmap app-config -n ecommerce
kubectl edit secret app-secrets -n ecommerce

# Restart deployment
kubectl rollout restart deployment/backend -n ecommerce
```

#### 1.3 Database Connection Failure
**Symptoms:**
- Connection timeout errors
- Authentication failures
- Network connectivity issues

**Debugging Steps:**
```bash
# Test database connectivity
kubectl exec <pod-name> -n ecommerce -- nc -zv postgres-service 5432

# Check database service
kubectl get svc postgres-service -n ecommerce
kubectl describe svc postgres-service -n ecommerce

# Check database endpoints
kubectl get endpoints postgres-service -n ecommerce
```

**Fix:**
```bash
# Verify database is running
kubectl get pods -n ecommerce | grep postgres

# Check database logs
kubectl logs deployment/postgres -n ecommerce

# Restart database if needed
kubectl rollout restart deployment/postgres -n ecommerce
```

## Scenario 2: High Latency

### Symptoms
- Slow API response times
- User complaints about performance
- Increased P95/P99 latency metrics
- Timeouts in client applications

### Metrics to Monitor
- `http_request_duration_seconds`
- `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`
- `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))`
- Database query response times
- CPU and memory usage

### Debugging Steps

#### 2.1 Identify Bottleneck
```bash
# Check current latency metrics
curl "http://prometheus-service:9090/api/v1/query?query=histogram_quantile(0.95,%20rate(http_request_duration_seconds_bucket[5m]))"

# Check slow queries
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SELECT query, mean_time, calls, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
"

# Check resource usage
kubectl top pods -n ecommerce
```

#### 2.2 Database Performance Issues
**Symptoms:**
- Slow query execution
- High database CPU usage
- Connection pool exhaustion

**Debugging:**
```bash
# Check database connections
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';
"

# Check slow queries
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SELECT query, mean_time, calls
FROM pg_stat_statements
WHERE mean_time > 1000
ORDER BY mean_time DESC;
"

# Check database size
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SELECT pg_size_pretty(pg_database_size('ecommerce'));
"
```

**Fix:**
```sql
-- Add indexes for slow queries
CREATE INDEX CONCURRENTLY idx_products_category ON products(category);
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);

-- Update statistics
ANALYZE;

-- Check query plan
EXPLAIN ANALYZE SELECT * FROM products WHERE category = 'Electronics';
```

#### 2.3 Application Performance Issues
**Symptoms:**
- High CPU usage in application pods
- Memory leaks
- Inefficient code paths

**Debugging:**
```bash
# Check application metrics
curl "http://backend-service:8080/metrics" | grep -E "(cpu|memory|duration)"

# Profile application
kubectl exec deployment/backend -n ecommerce -- node --inspect=0.0.0.0:9229 src/index.js

# Check heap usage
kubectl exec deployment/backend -n ecommerce -- node -e "
const v8 = require('v8');
const heap = v8.getHeapStatistics();
console.log('Heap Used:', heap.used_heap_size / 1024 / 1024, 'MB');
"
```

**Fix:**
```javascript
// Add caching for expensive operations
const cache = new Map();

async function getProducts(category) {
  const cacheKey = `products:${category}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  const products = await database.query('SELECT * FROM products WHERE category = $1', [category]);
  cache.set(cacheKey, products);
  
  // Set cache expiration
  setTimeout(() => cache.delete(cacheKey), 300000); // 5 minutes
  
  return products;
}
```

## Scenario 3: Database Connection Failure

### Symptoms
- 500 errors from API
- Database timeout errors
- Connection pool exhaustion
- Service degradation

### Metrics to Monitor
- `health_check_status{service="database"}`
- `database_response_time_seconds`
- Active database connections
- Connection pool usage

### Debugging Steps

#### 3.1 Check Database Service
```bash
# Verify database pod is running
kubectl get pods -n ecommerce | grep postgres

# Check database service
kubectl get svc postgres-service -n ecommerce
kubectl describe svc postgres-service -n ecommerce

# Test connectivity
kubectl run test-db --image=postgres:15-alpine --rm -it --restart=Never -- \
  psql "postgresql://postgres:password@postgres-service:5432/ecommerce" -c "SELECT 1;"
```

#### 3.2 Check Database Configuration
```bash
# Check database configuration
kubectl exec deployment/postgres -n ecommerce -- cat /var/lib/postgresql/data/postgresql.conf | grep -E "(max_connections|shared_buffers)"

# Check connection limits
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SHOW max_connections;
SHOW shared_buffers;
"
```

#### 3.3 Check Application Database Settings
```bash
# Check application database configuration
kubectl exec deployment/backend -n ecommerce -- env | grep -E "(DB_|POOL_)"

# Check connection pool status
curl "http://backend-service:8080/api/health/detailed" | jq '.services.database'
```

### Fix Strategies

#### 3.1 Increase Database Connections
```sql
-- Increase max connections in postgresql.conf
ALTER SYSTEM SET max_connections = 200;
SELECT pg_reload_conf();
```

#### 3.2 Optimize Connection Pool
```javascript
// Update database connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20, // Increase pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

#### 3.3 Implement Circuit Breaker
```javascript
// Add circuit breaker for database calls
const CircuitBreaker = require('opossum');

const dbOptions = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
};

const dbBreaker = new CircuitBreaker(databaseQuery, dbOptions);

dbBreaker.fallback(() => {
  return { error: 'Database temporarily unavailable' };
});
```

## Scenario 4: Disk Full Issue

### Symptoms
- Write failures in applications
- Database errors
- Log file creation failures
- Pod eviction

### Metrics to Monitor
- `node_filesystem_avail_bytes`
- `node_filesystem_size_bytes`
- Disk usage percentage
- I/O wait time

### Debugging Steps

#### 4.1 Check Disk Usage
```bash
# Check node disk usage
kubectl exec -n monitoring deployment/node-exporter -- df -h

# Check pod disk usage
kubectl exec <pod-name> -n ecommerce -- df -h

# Check persistent volumes
kubectl get pv
kubectl get pvc -n ecommerce
```

#### 4.2 Identify Large Files
```bash
# Find large files in pods
kubectl exec <pod-name> -n ecommerce -- find /app -type f -size +100M -exec ls -lh {} \;

# Check log file sizes
kubectl exec <pod-name> -n ecommerce -- du -sh /app/logs/*

# Check database size
kubectl exec deployment/postgres -n ecommerce -- psql -U postgres -d ecommerce -c "
SELECT pg_size_pretty(pg_database_size('ecommerce'));
"
```

### Fix Strategies

#### 4.1 Clean Up Log Files
```bash
# Rotate log files
kubectl exec <pod-name> -n ecommerce -- logrotate -f /etc/logrotate.conf

# Clean old logs
kubectl exec <pod-name> -n ecommerce -- find /app/logs -name "*.log" -mtime +7 -delete

# Compress old logs
kubectl exec <pod-name> -n ecommerce -- find /app/logs -name "*.log" -mtime +1 -exec gzip {} \;
```

#### 4.2 Increase Disk Space
```yaml
# Expand PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: ecommerce
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi  # Increased from 20Gi
```

#### 4.3 Implement Log Rotation
```yaml
# Add log rotation to containers
volumeMounts:
- name: logs
  mountPath: /app/logs
- name: logrotate-config
  mountPath: /etc/logrotate.d
volumes:
- name: logrotate-config
  configMap:
    name: logrotate-config
```

## Scenario 5: Misconfigured Config/Secret

### Symptoms
- Application startup failures
- Authentication errors
- Missing environment variables
- Configuration-related runtime errors

### Metrics to Monitor
- Pod startup failures
- Configuration reload errors
- Authentication failure rates

### Debugging Steps

#### 5.1 Check Configuration
```bash
# Check ConfigMaps
kubectl get configmaps -n ecommerce
kubectl describe configmap app-config -n ecommerce

# Check Secrets
kubectl get secrets -n ecommerce
kubectl describe secret app-secrets -n ecommerce

# Verify mounted configuration
kubectl exec <pod-name> -n ecommerce -- cat /app/config/config.json
```

#### 5.2 Check Environment Variables
```bash
# Check pod environment
kubectl exec <pod-name> -n ecommerce -- env | sort

# Compare with expected configuration
kubectl get configmap app-config -n ecommerce -o yaml

# Check secret mounting
kubectl exec <pod-name> -n ecommerce -- ls -la /etc/secrets/
```

### Fix Strategies

#### 5.1 Update Configuration
```bash
# Update ConfigMap
kubectl edit configmap app-config -n ecommerce

# Update Secret
kubectl create secret generic app-secrets --from-literal=jwt-secret=new-secret -n ecommerce --dry-run=client -o yaml | kubectl apply -f -

# Restart deployment
kubectl rollout restart deployment/backend -n ecommerce
```

#### 5.2 Validate Configuration
```javascript
// Add configuration validation
const Joi = require('joi');

const configSchema = Joi.object({
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().integer().min(1).max(65535).required(),
  JWT_SECRET: Joi.string().min(32).required(),
});

const { error } = configSchema.validate(process.env);
if (error) {
  console.error('Configuration validation failed:', error.details);
  process.exit(1);
}
```

## General Debugging Tools

### Health Check Scripts
```bash
#!/bin/bash
# comprehensive-health-check.sh

echo "=== System Health Check ==="
echo "Time: $(date)"
echo ""

# Check all services
services=("postgres" "redis" "backend" "frontend" "worker")

for service in "${services[@]}"; do
  echo "Checking $service..."
  
  # Check pod status
  pod_status=$(kubectl get pods -n ecommerce -l app=$service -o jsonpath='{.items[0].status.phase}')
  echo "  Pod Status: $pod_status"
  
  # Check service health
  if kubectl get svc $service-service -n ecommerce &>/dev/null; then
    echo "  Service: Available"
  else
    echo "  Service: Not Found"
  fi
  
  # Check metrics endpoint
  case $service in
    "backend"|"worker")
      if curl -f "http://$service-service:8080/health" &>/dev/null; then
        echo "  Health Check: PASS"
      else
        echo "  Health Check: FAIL"
      fi
      ;;
  esac
  
  echo ""
done

# Check resource usage
echo "=== Resource Usage ==="
kubectl top pods -n ecommerce
echo ""

# Check error rates
echo "=== Error Rates ==="
curl -s "http://prometheus-service:9090/api/v1/query?query=rate(http_requests_total{status_code=~\"5..\"}[5m])" | jq -r '.data.result[0].value[1]' | awk '{print "Error Rate: " $1 "%"}'
```

### Log Analysis Script
```bash
#!/bin/bash
# analyze-logs.sh

service=$1
hours=${2:-1}

echo "Analyzing logs for $service (last $hours hours)"

# Get pod logs
kubectl logs -n ecommerce deployment/$service --since=${hours}h | \
  jq -c 'select(.level == "error")' | \
  jq -r 'select(.timestamp) | "\(.timestamp) \(.message)"' | \
  sort | uniq -c | sort -nr
```

### Performance Testing Script
```bash
#!/bin/bash
# performance-test.sh

endpoint=$1
duration=${2:-60}
concurrency=${3:-10}

echo "Running performance test against $endpoint"
echo "Duration: ${duration}s"
echo "Concurrency: ${concurrency}"

# Run load test
ab -n $((duration * concurrency)) -c $concurrency "$endpoint" | \
  grep -E "(Requests per second|Time per request|Failed requests)"
```

## Prevention Strategies

### 1. Monitoring and Alerting
- Comprehensive health checks
- Resource usage monitoring
- Error rate tracking
- Performance baseline establishment

### 2. Testing and Validation
- Load testing before deployment
- Chaos engineering experiments
- Configuration validation
- Dependency testing

### 3. Architecture Improvements
- Circuit breakers for external dependencies
- Retry mechanisms with exponential backoff
- Graceful degradation
- Auto-scaling policies

### 4. Operational Excellence
- Regular backup testing
- Disaster recovery drills
- Documentation maintenance
- Knowledge sharing sessions

## Quick Reference Commands

### Service Status
```bash
kubectl get pods,services,deployments -n ecommerce
kubectl top pods -n ecommerce
```

### Logs and Events
```bash
kubectl logs -f deployment/<service> -n ecommerce
kubectl get events -n ecommerce --sort-by='.lastTimestamp'
```

### Debugging
```bash
kubectl exec -it <pod-name> -n ecommerce -- /bin/sh
kubectl describe pod <pod-name> -n ecommerce
kubectl port-forward svc/<service> 8080:8080 -n ecommerce
```

### Maintenance
```bash
kubectl rollout restart deployment/<service> -n ecommerce
kubectl rollout status deployment/<service> -n ecommerce
kubectl scale deployment/<service> --replicas=3 -n ecommerce
```