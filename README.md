# SRE E-Commerce Platform - Complete Site Reliability Engineering Reference Project

## 🎯 Project Overview

This project demonstrates a complete, production-inspired e-commerce platform built with modern microservices architecture, showcasing real-world Site Reliability Engineering (SRE) practices. It's designed as an interview-ready reference project that demonstrates how SREs work in a DevOps model.

## 🏗️ Architecture

```mermaid
graph TB
    subgraph "User Layer"
        U[Users] --> LB[Load Balancer]
    end
    
    subgraph "Application Layer"
        LB --> FE[Frontend Service]
        FE --> BE[Backend API Service]
        BE --> WK[Background Worker]
        BE --> DB[(PostgreSQL Database)]
    end
    
    subgraph "Monitoring Stack"
        P[Prometheus]
        G[Grafana]
        A[AlertManager]
        FE --> P
        BE --> P
        WK --> P
        DB --> P
        P --> G
        P --> A
    end
    
    subgraph "Logging Stack"
        ES[Elasticsearch]
        K[Kibana]
        LB --> ES
        FE --> ES
        BE --> ES
        WK --> ES
        ES --> K
    end
    
    subgraph "Infrastructure"
        K8S[Kubernetes Cluster]
        LB --> K8S
        K8S --> FE
        K8S --> BE
        K8S --> WK
        K8S --> DB
        K8S --> P
        K8S --> G
        K8S --> A
        K8S --> ES
        K8S --> K
    end
```

## 📁 Project Structure

```
sre-ecommerce-platform/
├── services/                    # Microservices applications
│   ├── frontend/               # React frontend service
│   ├── backend/                # Node.js/Express API service
│   ├── worker/                 # Background job processor
│   └── database/               # PostgreSQL database schemas
├── kubernetes/                 # Kubernetes manifests and configs
│   ├── manifests/             # Deployment, Service, ConfigMap manifests
│   └── configs/               # Configuration files
├── monitoring/                 # Monitoring stack configurations
│   ├── prometheus/            # Prometheus rules and configs
│   ├── grafana/               # Grafana dashboards
│   └── alertmanager/          # AlertManager routing rules
├── logging/                    # ELK stack configurations
├── scripts/                    # Setup, teardown, and utility scripts
├── docs/                      # Detailed documentation
├── tests/                     # Integration and load tests
└── .github/workflows/         # CI/CD pipelines
```

## 🚀 Quick Start

### What Was Fixed
This initial release addresses common deployment and reliability issues:
- **Service Dependencies**: Proper startup ordering and health checks to prevent race conditions
- **Resource Management**: Configured memory/CPU limits to prevent OOM failures
- **Database Connectivity**: Robust connection pooling with retry logic and circuit breakers
- **Monitoring Gaps**: Comprehensive metrics collection and alerting for all services
- **Configuration Errors**: Environment validation and proper secret management
- **Network Issues**: Service discovery with proper DNS resolution and health probing

### Prerequisites
- Docker Desktop (or Docker Engine)
- Docker Compose v2+
- kubectl (for Kubernetes deployment)
- Node.js 18+ (for local development)
- curl (for health checks)

### Local Development Setup
```bash
# Clone and setup
git clone <repository>
cd sre-ecommerce-platform

# Run comprehensive setup (includes error handling and validation)
./scripts/setup.sh

# Optional: Deploy to Kubernetes (Kind/Minikube)
./scripts/deploy-k8s.sh

# Access services (Docker Compose)
# Services are automatically available on localhost ports
```

### Services Access Points
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **Grafana**: http://localhost:3001 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Kibana**: http://localhost:5601
- **AlertManager**: http://localhost:9093

### Key Health Endpoints
- **Backend Health**: http://localhost:8080/health
- **Backend Metrics**: http://localhost:8080/metrics
- **Worker Health**: http://localhost:3002/health
- **Worker Metrics**: http://localhost:3002/metrics

## 🎯 What an SRE Does in This Project

### 1. System Reliability Management
- **SLI/SLO Implementation**: Monitor response times, error rates, and availability
- **Error Budget Management**: Track and report on service reliability targets
- **Capacity Planning**: Ensure services can handle expected load

### 2. Incident Management
- **Monitoring & Alerting**: Set up comprehensive monitoring and alerting rules
- **Incident Response**: Follow documented procedures for different failure scenarios
- **Post-mortem Analysis**: Document and learn from incidents

### 3. Automation & CI/CD
- **Deployment Automation**: Automated building, testing, and deployment pipelines
- **Infrastructure as Code**: Kubernetes manifests and configuration management
- **Self-healing Systems**: Automatic restarts, scaling, and recovery mechanisms

### 4. Performance & Scalability
- **Load Testing**: Regular performance testing and optimization
- **Horizontal Scaling**: Auto-scaling based on metrics
- **Resource Optimization**: Monitor and optimize resource usage

## 🔧 Kubernetes Deep Dive

### Core Components Demonstrated
- **Pods**: Basic deployment units for containers
- **Deployments**: Rolling updates and rollback capabilities
- **ReplicaSets**: Maintaining desired pod count
- **DaemonSets**: Monitoring and logging agents on all nodes
- **CronJobs**: Scheduled background tasks
- **Services**: Service discovery and load balancing
- **ConfigMaps & Secrets**: Configuration and credential management
- **Volumes**: Persistent data storage

### Common kubectl Commands
```bash
# Cluster management
kubectl cluster-info
kubectl get nodes
kubectl describe node <node-name>

# Application management
kubectl get pods --all-namespaces
kubectl get deployments
kubectl get services
kubectl describe deployment <deployment-name>
kubectl logs <pod-name>

# Scaling and updates
kubectl scale deployment <name> --replicas=3
kubectl set image deployment/<name> <container>=<new-image>
kubectl rollout status deployment/<name>
kubectl rollout undo deployment/<name>
```

## 📊 Monitoring & Observability

### Monitoring Verticals
1. **Application Health**
   - Response times and error rates
   - Business metrics (orders, user registrations)
   - Custom application metrics

2. **System Health**
   - CPU, memory, disk usage
   - Network latency and throughput
   - Container resource limits

3. **Database Monitoring**
   - Connection pool status
   - Query performance
   - Replication lag

4. **Log Monitoring**
   - Application logs
   - System logs
   - Security events

5. **Security Monitoring**
   - Authentication failures
   - Suspicious activity patterns
   - Vulnerability scanning

### Key Metrics & Alerts
- **High Error Rate**: >5% error rate for 5+ minutes
- **High Latency**: P95 latency >2 seconds for 3+ minutes
- **Service Unavailability**: Service down for >1 minute
- **Resource Exhaustion**: CPU >90% for 10+ minutes, Memory >85%
- **Database Issues**: Connection failures, slow queries

## 🚨 Incident Management Workflow

### Incident Levels
- **L1**: Basic troubleshooting (restart services, check logs)
- **L2**: Advanced debugging (performance issues, configuration)
- **L3**: Critical issues (infrastructure, security)

### On-Call Readiness
- **Escalation Policies**: Automatic escalation if no response
- **Runbooks**: Step-by-step procedures for common issues
- **Communication Channels**: Slack, PagerDuty, email alerts

### Sample Incident Scenarios
1. **Pod Crash Loop**: Container repeatedly failing to start
2. **High Latency**: API response times exceeding SLOs
3. **Database Connection Failure**: Service can't connect to database
4. **Disk Full**: Log or data volumes filling up
5. **Configuration Error**: Misconfigured secrets or configmaps

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
1. **Code Quality**: Linting and formatting checks
2. **Unit Tests**: Automated testing of individual services
3. **Build**: Docker image creation and tagging
4. **Security Scan**: Vulnerability scanning of images
5. **Integration Tests**: End-to-end testing
6. **Deployment**: Progressive deployment to Kubernetes

### Deployment Strategies
- **Blue-Green**: Zero-downtime deployments
- **Canary**: Gradual traffic shifting
- **Rolling**: Controlled rolling updates

## 🧪 Failure Scenarios & Debugging

### Scenario 1: Pod Crash Loop
**Symptoms**: Pod status shows `CrashLoopBackOff`
**Metrics**: High restart count, container exit codes
**Logs**: Application error messages, OOM killer events
**Root Cause**: Application configuration error or resource limits
**Fix**: Check pod logs, verify configuration, adjust resource requests

### Scenario 2: High Latency
**Symptoms**: Slow API responses, user complaints
**Metrics**: Increased P95/P99 latency, high CPU usage
**Logs**: Slow query logs, timeout errors
**Root Cause**: Database performance issues or resource constraints
**Fix**: Scale horizontally, optimize queries, add caching

### Scenario 3: Database Connection Failure
**Symptoms**: 500 errors, connection timeouts
**Metrics**: Database connection errors, high connection pool usage
**Logs**: Connection refused, authentication failed
**Root Cause**: Database down, network issues, credential rotation
**Fix**: Restart database, check connectivity, update credentials

## 📚 Learning Summary

### Key SRE Concepts Demonstrated
1. **Reliability Engineering**: SLI/SLO implementation and error budget management
2. **Incident Management**: Structured response to system failures
3. **Automation**: CI/CD pipelines and self-healing systems
4. **Monitoring**: Comprehensive observability stack
5. **Capacity Planning**: Resource scaling and performance optimization

### Real-World SRE Job Mapping
- **System Design**: Architecture decisions and trade-offs
- **Problem Solving**: Debugging complex distributed systems
- **Communication**: Incident documentation and stakeholder updates
- **Process Improvement**: Post-mortems and reliability enhancements
- **Tool Mastery**: Kubernetes, Prometheus, Grafana, ELK stack

### Interview Talking Points
1. **Architecture Decisions**: Why microservices, why Kubernetes
2. **Monitoring Strategy**: What to monitor and why
3. **Incident Response**: How to handle failures gracefully
4. **Automation**: How to reduce manual intervention
5. **Continuous Improvement**: How to evolve the system

### Next Steps to Explore
- **Service Mesh**: Istio or Linkerd implementation
- **Chaos Engineering**: Failure injection testing
- **Advanced Security**: Zero-trust networking, RBAC
- **Multi-Cluster**: Geographic distribution and disaster recovery
- **Cost Optimization**: Resource efficiency and rightsizing

## 🛠️ Setup Scripts

### Complete Setup with Error Recovery
```bash
# Recommended: Use the all-in-one setup script
./scripts/setup.sh

# This script includes:
# - Prerequisite validation
# - Service dependency management
# - Health check verification
# - Automatic recovery from common failures
# - Resource usage optimization
```

### Verification and Troubleshooting
```bash
# Run comprehensive health checks
./scripts/health-check.sh

# Verify fixes are working:
curl http://localhost:8080/health       # Backend health check
curl http://localhost:3000/health       # Frontend health check
curl http://localhost:8080/metrics      # Prometheus metrics
curl http://localhost:3002/health       # Worker health check
```

### Kubernetes Deployment
```bash
# Deploy to Kubernetes with error handling
./scripts/deploy-k8s.sh

# Verify deployment
kubectl get pods -n ecommerce
kubectl logs -f deployment/backend -n ecommerce
```

### Cleanup
```bash
# Remove all deployments and data
./scripts/teardown.sh

# Reset Docker environment (if needed)
docker-compose down --volumes --remove-orphans
docker system prune -f
```

## 🔧 How to Verify Fixes Are Working

### 1. Service Health Validation
```bash
# All services should return HTTP 200
./scripts/health-check.sh

# Manual verification:
curl -f http://localhost:3000/health     # Frontend
curl -f http://localhost:8080/health     # Backend
curl -f http://localhost:3002/health     # Worker
```

### 2. Database Connectivity Testing
```bash
# Verify PostgreSQL connectivity
docker-compose exec -T postgres pg_isready -U postgres -d ecommerce

# Verify Redis connectivity
docker-compose exec -T redis redis-cli ping
```

### 3. Monitoring Stack Verification
```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Verify Grafana datasources
curl -u admin:admin http://localhost:3001/api/datasources

# Test AlertManager
curl http://localhost:9093/-/healthy
```

### 4. Load Testing and Performance
```bash
# Run built-in load test
npm install -g artillery
artillery run tests/load/load-test.yml

# Expected: <2s response time, <1% error rate
```

### 5. Error Recovery Testing
```bash
# Test service restart resilience
docker-compose restart backend
# Verify automatic recovery within 60s

# Test database failure handling
docker-compose stop postgres
sleep 30
docker-compose start postgres
# Verify backend reconnects automatically
```

## 📖 Additional Documentation

- [Quick Start Guide](QUICK_START.md) - 5-minute setup guide
- [Detailed Architecture Guide](docs/architecture.md)
- [SRE Playbooks](docs/playbooks/)
- [Monitoring Setup](docs/monitoring.md)
- [Troubleshooting Guide](docs/troubleshooting.md)
- [Performance Tuning](docs/performance.md)
- [Failure Scenarios](docs/failure-scenarios.md) - Common issues and solutions
- [Incident Management](docs/incident-management.md) - SRE procedures
- [SLO/SLI Documentation](docs/slo-sli.md) - Reliability targets

## 🎯 Breaking Changes and Migration Notes

### Current Version: 1.0.0 (Initial Release)

**No breaking changes** - This is the initial stable release with:
- ✅ Production-ready microservices architecture
- ✅ Comprehensive monitoring and observability
- ✅ Automated deployment with error handling
- ✅ Security best practices implemented
- ✅ Performance optimization and scaling

### Migration from Previous (Hypothetical) Setup
If migrating from a basic setup:
- Replace manual service startup with `./scripts/setup.sh`
- Update monitoring endpoints to include health checks
- Configure service discovery via Docker Compose networking
- Implement proper logging with structured JSON format

---

**Built for SRE interviews and learning purposes. This project demonstrates production-ready SRE practices using modern DevOps tools and methodologies.**

### Validation Checklist
- [ ] All services start without errors
- [ ] Health checks pass for all services
- [ ] Monitoring dashboards are populated
- [ ] Load tests meet performance targets
- [ ] Error recovery mechanisms work correctly
- [ ] Security configurations are applied
- [ ] Logs are being collected and indexed