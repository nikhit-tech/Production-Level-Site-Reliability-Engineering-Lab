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
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Service health checks
check_service() {
    local service_name=$1
    local url=$2
    local expected_status=${3:-200}
    
    log_info "Checking $service_name at $url"
    
    if response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null); then
        if [ "$response" -eq "$expected_status" ]; then
            log_success "$service_name is healthy (HTTP $response)"
            return 0
        else
            log_error "$service_name returned HTTP $response (expected $expected_status)"
            return 1
        fi
    else
        log_error "$service_name is not accessible"
        return 1
    fi
}

# Database connectivity checks
check_database() {
    local service_name=$1
    local host=$2
    local port=$3
    
    log_info "Checking $service_name connectivity to $host:$port"
    
    if nc -z "$host" "$port" 2>/dev/null; then
        log_success "$service_name is reachable"
        return 0
    else
        log_error "$service_name is not reachable"
        return 1
    fi
}

# API endpoint tests
test_api_endpoints() {
    log_info "Testing API endpoints..."
    
    # Test health endpoints
    check_service "Backend Health" "http://localhost:8080/health"
    check_service "Backend Liveness" "http://localhost:8080/api/health/liveness"
    check_service "Backend Readiness" "http://localhost:8080/api/health/readiness"
    check_service "Worker Health" "http://localhost:3002/health"
    
    # Test metrics endpoints
    check_service "Backend Metrics" "http://localhost:8080/metrics"
    check_service "Worker Metrics" "http://localhost:3002/metrics"
    
    # Test frontend
    check_service "Frontend" "http://localhost:3000/health"
    
    log_info "Testing API functionality..."
    
    # Test products endpoint
    if curl -s "http://localhost:8080/api/products" | grep -q "products"; then
        log_success "Products API endpoint working"
    else
        log_warning "Products API endpoint not working correctly"
    fi
    
    # Test order stats
    if curl -s "http://localhost:8080/api/orders/stats/summary" | grep -q "summary"; then
        log_success "Order stats endpoint working"
    else
        log_warning "Order stats endpoint not working correctly"
    fi
}

# Monitoring stack tests
test_monitoring() {
    log_info "Testing monitoring stack..."
    
    check_service "Prometheus" "http://localhost:9090/-/healthy"
    check_service "Grafana" "http://localhost:3001/api/health"
    check_service "AlertManager" "http://localhost:9093/-/healthy"
    check_service "Kibana" "http://localhost:5601/api/status"
    
    # Test Prometheus metrics collection
    log_info "Testing Prometheus metrics collection..."
    if curl -s "http://localhost:9090/api/v1/query?query=up" | grep -q "metric"; then
        log_success "Prometheus is collecting metrics"
    else
        log_warning "Prometheus metrics collection may have issues"
    fi
    
    # Test Grafana datasources
    log_info "Testing Grafana datasources..."
    if curl -s -u admin:admin "http://localhost:3001/api/datasources" | grep -q "Prometheus"; then
        log_success "Grafana Prometheus datasource configured"
    else
        log_warning "Grafana datasource configuration may have issues"
    fi
}

# Resource utilization checks
check_resources() {
    log_info "Checking resource utilization..."
    
    # Get container stats
    if docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" 2>/dev/null | head -10; then
        log_success "Resource stats collected"
    else
        log_warning "Could not collect resource stats"
    fi
    
    # Check disk space
    log_info "Checking disk space..."
    if df -h | grep -E "(Filesystem|/dev/)"; then
        log_success "Disk space information collected"
    fi
}

# Performance tests
run_performance_tests() {
    log_info "Running basic performance tests..."
    
    # Test API response time
    log_info "Testing API response times..."
    
    # Simple load test on health endpoint
    for i in {1..5}; do
        start_time=$(date +%s%N)
        curl -s "http://localhost:8080/health" > /dev/null
        end_time=$(date +%s%N)
        response_time=$((($end_time - $start_time) / 1000000))
        log_info "Request $i: ${response_time}ms"
    done
    
    # Test concurrent connections
    log_info "Testing concurrent connections..."
    if command -v ab &> /dev/null; then
        ab -n 50 -c 5 "http://localhost:3000/" 2>/dev/null | grep "Requests per second" || log_warning "Apache bench test failed"
    else
        log_warning "Apache bench (ab) not available for performance testing"
    fi
}

# Security checks
run_security_checks() {
    log_info "Running basic security checks..."
    
    # Check for exposed ports
    log_info "Checking exposed ports..."
    if netstat -tuln 2>/dev/null | grep LISTEN | head -10; then
        log_success "Port information collected"
    fi
    
    # Check for default passwords (basic check)
    log_warning "SECURITY REMINDER: Change default passwords in production!"
    echo "  - Grafana: admin/admin"
    echo "  - PostgreSQL: postgres/password"
    echo "  - Redis: redispassword"
}

# Main execution
main() {
    echo ""
    log_info "Starting comprehensive health check..."
    echo ""
    
    local failed_checks=0
    
    # Run all checks
    test_api_endpoints || ((failed_checks++))
    test_monitoring || ((failed_checks++))
    check_database "PostgreSQL" "localhost" "5432" || ((failed_checks++))
    check_database "Redis" "localhost" "6379" || ((failed_checks++))
    check_resources
    run_performance_tests
    run_security_checks
    
    echo ""
    if [ $failed_checks -eq 0 ]; then
        log_success "All critical checks passed!"
    else
        log_warning "$failed_checks check(s) failed. Review the output above."
    fi
    
    echo ""
    log_info "Health check completed at $(date)"
    echo ""
}

# Run main function
main "$@"