#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisite() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 is not installed. Please install $1 first."
        exit 1
    fi
}

# Check prerequisites
log_info "Checking prerequisites..."
check_prerequisite "kubectl"
check_prerequisite "docker"

# Check if cluster is available
if ! kubectl cluster-info &> /dev/null; then
    log_error "Kubernetes cluster is not available. Please set up a cluster first."
    exit 1
fi

log_success "Prerequisites are satisfied."

# Configuration
NAMESPACE="ecommerce"
MONITORING_NAMESPACE="monitoring"
LOGGING_NAMESPACE="logging"

# Create namespaces
log_info "Creating namespaces..."
kubectl apply -f kubernetes/manifests/namespace.yaml

# Apply secrets and configmaps
log_info "Applying secrets and configmaps..."
kubectl apply -f kubernetes/manifests/secrets.yaml
kubectl apply -f kubernetes/manifests/configmaps.yaml

# Deploy infrastructure services
log_info "Deploying infrastructure services..."
kubectl apply -f kubernetes/manifests/postgres.yaml
kubectl apply -f kubernetes/manifests/redis.yaml

# Wait for database to be ready
log_info "Waiting for database to be ready..."
kubectl wait --for=condition=ready pod -l app=postgres -n $NAMESPACE --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n $NAMESPACE --timeout=300s

# Deploy application services
log_info "Deploying application services..."
kubectl apply -f kubernetes/manifests/backend.yaml
kubectl apply -f kubernetes/manifests/frontend.yaml
kubectl apply -f kubernetes/manifests/worker.yaml

# Wait for application services to be ready
log_info "Waiting for application services to be ready..."
kubectl wait --for=condition=available deployment/backend -n $NAMESPACE --timeout=600s
kubectl wait --for=condition=available deployment/frontend -n $NAMESPACE --timeout=600s
kubectl wait --for=condition=available deployment/worker -n $NAMESPACE --timeout=600s

# Deploy monitoring stack
log_info "Deploying monitoring stack..."
kubectl apply -f kubernetes/manifests/monitoring.yaml

# Wait for monitoring services to be ready
log_info "Waiting for monitoring services to be ready..."
kubectl wait --for=condition=available deployment/prometheus -n $MONITORING_NAMESPACE --timeout=600s
kubectl wait --for=condition=available deployment/grafana -n $MONITORING_NAMESPACE --timeout=600s
kubectl wait --for=condition=available deployment/alertmanager -n $MONITORING_NAMESPACE --timeout=600s

# Deploy ingress
log_info "Deploying ingress..."
kubectl apply -f kubernetes/manifests/ingress.yaml

# Verify deployment
log_info "Verifying deployment..."

# Check pod status
echo ""
log_info "Pod Status:"
kubectl get pods -n $NAMESPACE
echo ""
kubectl get pods -n $MONITORING_NAMESPACE

# Check services
echo ""
log_info "Services:"
kubectl get services -n $NAMESPACE
echo ""
kubectl get services -n $MONITORING_NAMESPACE

# Check ingress
echo ""
log_info "Ingress:"
kubectl get ingress -n $NAMESPACE
echo ""
kubectl get ingress -n $MONITORING_NAMESPACE

# Get service URLs
log_info "Getting service URLs..."

# For local clusters (minikube, kind)
if command -v minikube &> /dev/null; then
    log_info "Minikube detected, getting service URLs..."
    minikube service list -n $NAMESPACE
    minikube service list -n $MONITORING_NAMESPACE
elif command -v kind &> /dev/null; then
    log_info "Kind detected, using port-forwarding..."
    log_info "Run the following commands to access services:"
    echo ""
    echo "# Frontend"
    echo "kubectl port-forward svc/frontend-service 3000:3000 -n $NAMESPACE"
    echo ""
    echo "# Backend API"
    echo "kubectl port-forward svc/backend-service 8080:8080 -n $NAMESPACE"
    echo ""
    echo "# Grafana"
    echo "kubectl port-forward svc/grafana-service 3001:3000 -n $MONITORING_NAMESPACE"
    echo ""
    echo "# Prometheus"
    echo "kubectl port-forward svc/prometheus-service 9090:9090 -n $MONITORING_NAMESPACE"
else
    log_info "Getting LoadBalancer IPs..."
    FRONTEND_IP=$(kubectl get svc frontend-service -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    BACKEND_IP=$(kubectl get svc backend-service -n $NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    GRAFANA_IP=$(kubectl get svc grafana-service -n $MONITORING_NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    PROMETHEUS_IP=$(kubectl get svc prometheus-service -n $MONITORING_NAMESPACE -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    
    echo ""
    log_info "Service URLs:"
    echo "  Frontend:       http://$FRONTEND_IP:3000"
    echo "  Backend API:    http://$BACKEND_IP:8080"
    echo "  Grafana:        http://$GRAFANA_IP:3000"
    echo "  Prometheus:     http://$PROMETHEUS_IP:9090"
fi

# Run health checks
log_info "Running health checks..."
sleep 30

# Check application health
if kubectl exec -n $NAMESPACE deployment/backend -- curl -f http://localhost:8080/health &> /dev/null; then
    log_success "Backend health check passed"
else
    log_warning "Backend health check failed"
fi

if kubectl exec -n $NAMESPACE deployment/frontend -- curl -f http://localhost:3000/health &> /dev/null; then
    log_success "Frontend health check passed"
else
    log_warning "Frontend health check failed"
fi

# Display final status
echo ""
log_success "Kubernetes deployment completed!"
echo ""
log_info "Next Steps:"
echo "1. Access the services using the URLs above"
echo "2. Check Grafana dashboards at http://localhost:3001 (admin/admin)"
echo "3. View metrics in Prometheus at http://localhost:9090"
echo "4. Monitor logs in Kibana at http://localhost:5601"
echo ""
log_info "Useful Commands:"
echo "  View logs:      kubectl logs -f deployment/<service> -n $NAMESPACE"
echo "  Scale service:  kubectl scale deployment/<service> --replicas=3 -n $NAMESPACE"
echo "  Restart:       kubectl rollout restart deployment/<service> -n $NAMESPACE"
echo "  Get status:     kubectl get pods,services -n $NAMESPACE"
echo ""

# Save deployment info
DEPLOYMENT_INFO="deployment-info-$(date +%Y%m%d-%H%M%S).txt"
cat > $DEPLOYMENT_INFO << EOF
Deployment Information
=====================
Date: $(date)
Namespace: $NAMESPACE
Monitoring Namespace: $MONITORING_NAMESPACE

Pod Status:
$(kubectl get pods -n $NAMESPACE)

Services:
$(kubectl get services -n $NAMESPACE)

Ingress:
$(kubectl get ingress -n $NAMESPACE)

Events (last 10):
$(kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10)
EOF

log_info "Deployment information saved to $DEPLOYMENT_INFO"