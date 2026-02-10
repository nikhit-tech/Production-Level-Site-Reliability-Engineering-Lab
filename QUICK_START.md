# Quick Start Guide

## 🚀 Quick Setup (5 minutes)

### Option 1: Docker Compose (Recommended for Local Development)

```bash
# Clone the repository
git clone <repository-url>
cd sre-ecommerce-platform

# Run the setup script
./scripts/setup.sh

# Access the services
open http://localhost:3000        # Frontend
open http://localhost:8080        # Backend API
open http://localhost:3001        # Grafana (admin/admin)
open http://localhost:9090        # Prometheus
open http://localhost:5601        # Kibana
```

### Option 2: Kubernetes (Advanced)

```bash
# Prerequisites: Kubernetes cluster (minikube, kind, or k3s)
# Install kubectl if not already installed

# Deploy to Kubernetes
./scripts/deploy-k8s.sh

# For local clusters, use port-forwarding
kubectl port-forward svc/frontend-service 3000:3000 -n ecommerce &
kubectl port-forward svc/backend-service 8080:8080 -n ecommerce &
kubectl port-forward svc/grafana-service 3001:3000 -n monitoring &
kubectl port-forward svc/prometheus-service 9090:9090 -n monitoring &
```

## 🧪 Verify Setup

### Health Check
```bash
# Run comprehensive health check
./scripts/health-check.sh

# Manual health checks
curl http://localhost:3000/health     # Frontend
curl http://localhost:8080/health     # Backend
curl http://localhost:8080/metrics    # Metrics
```

### Test API Endpoints
```bash
# Get products
curl http://localhost:8080/api/products

# Get health details
curl http://localhost:8080/api/health/detailed

# Get order statistics
curl http://localhost:8080/api/orders/stats/summary
```

## 📊 Access Monitoring

### Grafana Dashboards
- URL: http://localhost:3001
- Login: admin/admin
- Pre-configured dashboards:
  - Application Metrics
  - System Health
  - SLO Monitoring
  - Error Budget Tracking

### Prometheus
- URL: http://localhost:9090
- Query examples:
  - Rate of requests: `rate(http_requests_total[5m])`
  - Error rate: `rate(http_requests_total{status_code=~"5.."}[5m])`
  - Response time: `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`

### Kibana (Logs)
- URL: http://localhost:5601
- Create index pattern: `ecommerce-logs-*`
- Explore logs from all services

## 🔧 Common Tasks

### Scale Services
```bash
# Docker Compose
docker-compose up -d --scale backend=3 --scale worker=2

# Kubernetes
kubectl scale deployment backend --replicas=5 -n ecommerce
kubectl scale deployment frontend --replicas=3 -n ecommerce
```

### View Logs
```bash
# Docker Compose
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f worker

# Kubernetes
kubectl logs -f deployment/backend -n ecommerce
kubectl logs -f deployment/frontend -n ecommerce
kubectl logs -f deployment/worker -n ecommerce
```

### Restart Services
```bash
# Docker Compose
docker-compose restart backend

# Kubernetes
kubectl rollout restart deployment/backend -n ecommerce
```

### Check Resource Usage
```bash
# Docker Compose
docker stats

# Kubernetes
kubectl top pods -n ecommerce
kubectl top nodes
```

## 🧪 Run Load Tests

```bash
# Install artillery (if not installed)
npm install -g artillery

# Run load test
artillery run tests/load/load-test.yml

# View results
# Results will be displayed in the console and saved to a JSON file
```

## 🚨 Simulate Failures

### Kill a Backend Pod
```bash
# Kubernetes
kubectl delete pod -l app=backend -n ecommerce

# Watch the pod get recreated
kubectl get pods -l app=backend -n ecommerce -w
```

### Disable Database
```bash
# Docker Compose
docker-compose stop postgres

# Watch the backend fail and recover
docker-compose logs -f backend

# Restart database
docker-compose start postgres
```

### High CPU Usage
```bash
# Generate CPU load on a pod
kubectl exec -it deployment/backend -n ecommerce -- /bin/sh
# Inside the pod:
dd if=/dev/zero of=/dev/null | dd if=/dev/zero of=/dev/null &
```

## 📈 SLO Monitoring

### Check Error Budget
```bash
# In Prometheus UI
# Query: (1 - rate(http_requests_total{status_code!~"5.."}[5m]) / rate(http_requests_total[5m])) < 0.999

# Check alert status in AlertManager
# URL: http://localhost:9093
```

### Create SLO Burn Alert
```bash
# The alert is already configured in Prometheus
# It will trigger if error rate exceeds 1% for 5 minutes
```

## 🔍 Debug Common Issues

### Service Not Starting
```bash
# Check pod status
kubectl get pods -n ecommerce

# Check pod events
kubectl describe pod <pod-name> -n ecommerce

# Check logs
kubectl logs <pod-name> -n ecommerce
```

### Database Connection Issues
```bash
# Test database connectivity
kubectl run test-db --image=postgres:15-alpine --rm -it --restart=Never -- \
  psql "postgresql://postgres:password@postgres-service:5432/ecommerce" -c "SELECT 1;"
```

### High Memory Usage
```bash
# Check memory usage
kubectl top pods -n ecommerce --sort-by=memory

# Check memory limits
kubectl describe pod <pod-name> -n ecommerce | grep -A 10 "Limits:"
```

## 🛠️ Development Workflow

### Make Changes to Backend
```bash
# Edit code in services/backend/
# Rebuild and restart
docker-compose up -d --build backend

# Or for Kubernetes:
docker build -t ecommerce-backend:dev ./services/backend
kubectl set image deployment/backend backend=ecommerce-backend:dev -n ecommerce
```

### Add New Metrics
```bash
# Add Prometheus metrics to your service
# Example in services/backend/src/index.js:
const newCounter = new promClient.Counter({
  name: 'custom_metric_total',
  help: 'Description of custom metric'
});

# Increment the metric in your code
newCounter.inc();

# Verify metric is available
curl http://localhost:8080/metrics | grep custom_metric
```

### Add New Alerts
```bash
# Edit monitoring/prometheus/alerts.yml
# Add your alert rule

# Reload Prometheus configuration
curl -X POST http://localhost:9090/-/reload
```

## 📚 Next Steps

1. **Explore the architecture**: Read the main README.md
2. **Understand SRE practices**: Check docs/slo-sli.md
3. **Learn incident management**: Read docs/incident-management.md
4. **Practice failure scenarios**: Review docs/failure-scenarios.md
5. **Customize monitoring**: Modify Grafana dashboards
6. **Add your own services**: Extend the platform

## 🆘 Need Help?

### Troubleshooting Checklist
- [ ] All services are running: `docker-compose ps` or `kubectl get pods`
- [ ] No resource constraints: Check memory/CPU limits
- [ ] Network connectivity: Services can reach each other
- [ ] Configuration correct: Check environment variables
- [ ] Logs show errors: Check application logs

### Common Solutions
```bash
# Reset everything
docker-compose down
docker system prune -f
./scripts/setup.sh

# Reset Kubernetes
./scripts/teardown.sh
./scripts/deploy-k8s.sh

# Fix permission issues
sudo chown -R $USER:$USER ./
```

### Get Help
- Check the detailed documentation in the `docs/` directory
- Review failure scenarios in `docs/failure-scenarios.md`
- Look at logs for specific error messages
- Check monitoring dashboards for system health

## 🎯 Interview Preparation

This project demonstrates key SRE concepts:

1. **System Design**: Microservices architecture
2. **Reliability**: High availability, fault tolerance
3. **Monitoring**: Comprehensive observability stack
4. **Incident Response**: Structured problem-solving
5. **Automation**: CI/CD, self-healing systems
6. **Performance**: Load testing, optimization

Practice explaining:
- Architecture decisions and trade-offs
- Monitoring and alerting strategy
- Incident response procedures
- SLO implementation and error budgets
- Scalability and reliability patterns

Good luck with your SRE interviews! 🚀