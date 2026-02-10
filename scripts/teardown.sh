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

# Configuration
NAMESPACE="ecommerce"
MONITORING_NAMESPACE="monitoring"
LOGGING_NAMESPACE="logging"

# Function to delete resources safely
delete_resources() {
    local resource_type=$1
    local namespace=$2
    local label_selector=$3
    
    if [ -n "$label_selector" ]; then
        log_info "Deleting $resource_type with label $label_selector in namespace $namespace..."
        kubectl delete $resource_type -n $namespace -l $label_selector --ignore-not-found=true
    else
        log_info "Deleting all $resource_type in namespace $namespace..."
        kubectl delete $resource_type -n $namespace --all --ignore-not-found=true
    fi
}

# Function to wait for deletion
wait_for_deletion() {
    local resource_type=$1
    local namespace=$2
    local timeout=${3:-120}
    
    log_info "Waiting for $resource_type deletion in namespace $namespace..."
    kubectl wait --for=delete $resource_type --all -n $namespace --timeout=${timeout}s || true
}

log_info "Starting teardown of SRE E-Commerce Platform..."

# Confirm deletion
read -p "Are you sure you want to delete all resources? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Teardown cancelled."
    exit 0
fi

# Stop port-forwarding processes
log_info "Stopping any port-forwarding processes..."
pkill -f "kubectl port-forward" || true

# Delete application deployments first
log_info "Deleting application deployments..."
delete_resources "deployment" $NAMESPACE "app=backend"
delete_resources "deployment" $NAMESPACE "app=frontend"
delete_resources "deployment" $NAMESPACE "app=worker"

# Delete application services
log_info "Deleting application services..."
delete_resources "service" $NAMESPACE "app=backend"
delete_resources "service" $NAMESPACE "app=frontend"
delete_resources "service" $NAMESPACE "app=worker"

# Delete monitoring stack
log_info "Deleting monitoring stack..."
delete_resources "deployment" $MONITORING_NAMESPACE
delete_resources "service" $MONITORING_NAMESPACE
delete_resources "configmap" $MONITORING_NAMESPACE
delete_resources "secret" $MONITORING_NAMESPACE

# Delete infrastructure services
log_info "Deleting infrastructure services..."
delete_resources "statefulset" $NAMESPACE "app=postgres"
delete_resources "deployment" $NAMESPACE "app=redis"
delete_resources "service" $NAMESPACE "app=postgres"
delete_resources "service" $NAMESPACE "app=redis"

# Delete ingress
log_info "Deleting ingress..."
delete_resources "ingress" $NAMESPACE
delete_resources "ingress" $MONITORING_NAMESPACE

# Delete other resources
log_info "Deleting other resources..."
delete_resources "configmap" $NAMESPACE
delete_resources "secret" $NAMESPACE
delete_resources "pvc" $NAMESPACE
delete_resources "pvc" $MONITORING_NAMESPACE

# Delete HPA and PDB
log_info "Deleting HPA and PDB..."
kubectl delete hpa --all -n $NAMESPACE --ignore-not-found=true
kubectl delete hpa --all -n $MONITORING_NAMESPACE --ignore-not-found=true
kubectl delete pdb --all -n $NAMESPACE --ignore-not-found=true
kubectl delete pdb --all -n $MONITORING_NAMESPACE --ignore-not-found=true

# Wait for pods to terminate
log_info "Waiting for pods to terminate..."
kubectl wait --for=delete pod --all -n $NAMESPACE --timeout=300s || true
kubectl wait --for=delete pod --all -n $MONITORING_NAMESPACE --timeout=300s || true

# Delete namespaces (optional)
read -p "Delete namespaces as well? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Deleting namespaces..."
    kubectl delete namespace $NAMESPACE --ignore-not-found=true
    kubectl delete namespace $MONITORING_NAMESPACE --ignore-not-found=true
    kubectl delete namespace $LOGGING_NAMESPACE --ignore-not-found=true
    
    # Wait for namespace deletion
    kubectl wait --for=delete namespace $NAMESPACE --timeout=120s || true
    kubectl wait --for=delete namespace $MONITORING_NAMESPACE --timeout=120s || true
fi

# Clean up Docker resources (optional)
read -p "Clean up Docker resources as well? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Cleaning up Docker resources..."
    
    # Stop and remove containers
    docker-compose down --remove-orphans 2>/dev/null || true
    
    # Remove images
    docker images | grep ecommerce | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true
    
    # Remove volumes
    docker volume ls | grep ecommerce | awk '{print $2}' | xargs -r docker volume rm -f 2>/dev/null || true
    
    # Clean up unused resources
    docker system prune -f 2>/dev/null || true
fi

# Clean up local files (optional)
read -p "Clean up local log and data files? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Cleaning up local files..."
    
    # Remove log files
    rm -rf logs/* 2>/dev/null || true
    
    # Remove data files
    rm -rf data/* 2>/dev/null || true
    
    # Remove deployment info files
    rm -f deployment-info-*.txt 2>/dev/null || true
    
    # Remove temporary files
    rm -f kubeconfig 2>/dev/null || true
fi

# Final status check
log_info "Checking final status..."
echo ""
log_info "Remaining namespaces:"
kubectl get namespaces | grep -E "(ecommerce|monitoring|logging)" || echo "  None"
echo ""
log_info "Remaining pods in all namespaces:"
kubectl get pods --all-namespaces | grep -E "(ecommerce|monitoring|logging)" || echo "  None"
echo ""
log_info "Remaining PVCs:"
kubectl get pvc --all-namespaces | grep -E "(ecommerce|monitoring|logging)" || echo "  None"

log_success "Teardown completed successfully!"
echo ""
log_info "If you want to completely remove Docker resources, run:"
echo "  docker system prune -a --volumes"
echo ""
log_info "To set up the platform again, run:"
echo "  ./scripts/setup.sh                    # For Docker Compose"
echo "  ./scripts/deploy-k8s.sh               # For Kubernetes"