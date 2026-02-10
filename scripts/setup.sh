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
check_prerequisite "docker"
check_prerequisite "docker-compose"
check_prerequisite "kubectl"

# Check if Docker is running
if ! docker info &> /dev/null; then
    log_error "Docker is not running. Please start Docker first."
    exit 1
fi

log_success "All prerequisites are satisfied."

# Create necessary directories
log_info "Creating necessary directories..."
mkdir -p logs/{backend,worker,grafana,prometheus,alertmanager}
mkdir -p data/{postgres,redis,elasticsearch}
mkdir -p monitoring/{prometheus,grafana,alertmanager}

# Build and start services
log_info "Building and starting services with Docker Compose..."
docker-compose down --remove-orphans
docker-compose build --no-cache
docker-compose up -d

# Wait for services to be ready
log_info "Waiting for services to be ready..."
sleep 30

# Check service health
check_service_health() {
    local service_name=$1
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose ps $service_name | grep -q "Up (healthy)"; then
            log_success "$service_name is healthy"
            return 0
        fi
        log_info "Waiting for $service_name to be healthy... (attempt $attempt/$max_attempts)"
        sleep 10
        ((attempt++))
    done
    
    log_error "$service_name failed to become healthy"
    return 1
}

# Check critical services
log_info "Checking critical services..."
check_service_health "postgres"
check_service_health "redis"
check_service_health "backend"
check_service_health "frontend"
check_service_health "worker"
check_service_health "prometheus"
check_service_health "grafana"

# Initialize sample data
log_info "Initializing sample data..."
docker-compose exec -T backend npm run seed || log_warning "Sample data initialization failed or not available"

# Verify services are accessible
log_info "Verifying service endpoints..."

# Check frontend
if curl -f http://localhost:3000/health &> /dev/null; then
    log_success "Frontend is accessible at http://localhost:3000"
else
    log_error "Frontend is not accessible"
fi

# Check backend
if curl -f http://localhost:8080/health &> /dev/null; then
    log_success "Backend is accessible at http://localhost:8080"
else
    log_error "Backend is not accessible"
fi

# Check Prometheus
if curl -f http://localhost:9090/-/healthy &> /dev/null; then
    log_success "Prometheus is accessible at http://localhost:9090"
else
    log_error "Prometheus is not accessible"
fi

# Check Grafana
if curl -f http://localhost:3001/api/health &> /dev/null; then
    log_success "Grafana is accessible at http://localhost:3001"
else
    log_error "Grafana is not accessible"
fi

# Check Kibana
if curl -f http://localhost:5601/api/status &> /dev/null; then
    log_success "Kibana is accessible at http://localhost:5601"
else
    log_error "Kibana is not accessible"
fi

# Display service URLs
echo ""
log_success "Setup completed successfully!"
echo ""
log_info "Service URLs:"
echo "  Frontend:       http://localhost:3000"
echo "  Backend API:    http://localhost:8080"
echo "  Prometheus:     http://localhost:9090"
echo "  Grafana:        http://localhost:3001 (admin/admin)"
echo "  Kibana:         http://localhost:5601"
echo "  AlertManager:   http://localhost:9093"
echo ""
log_info "API Endpoints:"
echo "  Health Check:   http://localhost:8080/health"
echo "  Metrics:        http://localhost:8080/metrics"
echo "  Worker Metrics: http://localhost:3002/metrics"
echo ""
log_info "Database Connections:"
echo "  PostgreSQL:     localhost:5432"
echo "  Redis:          localhost:6379"
echo ""
log_warning "Default Credentials:"
echo "  Grafana:        admin/admin"
echo "  PostgreSQL:     postgres/password"
echo "  Redis:          redispassword"
echo ""
log_info "Useful Commands:"
echo "  View logs:      docker-compose logs -f [service]"
echo "  Stop services:  docker-compose down"
echo "  Restart:        docker-compose restart [service]"
echo "  Shell access:   docker-compose exec [service] sh"
echo ""

# Run initial tests
log_info "Running basic health tests..."
./scripts/health-check.sh || log_warning "Some health checks failed"

log_success "Setup script completed!"