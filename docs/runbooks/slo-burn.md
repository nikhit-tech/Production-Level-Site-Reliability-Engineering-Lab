# Runbook: SLO Error Budget Burn

**Alerts:** `SLOErrorBudgetBurnFast`, `SLOErrorBudgetBurnSlow`  
**SLO:** 99.9% availability over 30 days (43.2 minutes error budget/month)

## Burn Rate Reference

| Alert | Burn Rate | Budget consumed | Time window |
|-------|-----------|-----------------|-------------|
| Fast  | 14.4×     | 2% in 1 hour    | 1h          |
| Slow  | 6×        | 5% in 6 hours   | 6h          |

## Diagnosis

```bash
# Current burn rate (should be ≤ 1× to stay within budget)
curl -s 'http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status_code=~"5.."}[1h])/rate(http_requests_total[1h])/0.001'

# Remaining error budget (minutes)
curl -s 'http://prometheus:9090/api/v1/query?query=(job:http_request_success_ratio:rate30d - 0.999)/0.001*43.2'

# Open the SLO Grafana dashboard
# http://grafana:3001/d/ecommerce-slo
```

## Remediation

1. **Fast burn (critical):** Treat as an active incident. Follow [high-error-rate runbook](./high-error-rate.md).
2. **Slow burn (warning):** Investigate trending degradation before it becomes critical.
3. If budget < 10 minutes remaining: freeze non-critical deployments.
4. If budget exhausted: invoke error budget policy — halt feature work, focus only on reliability.

## Error Budget Policy

- **> 50% remaining:** Normal operations
- **25–50% remaining:** Review reliability work items; increase monitoring frequency
- **< 25% remaining:** Freeze non-critical changes; SRE team lead approval required for deployments
- **Exhausted:** Full deployment freeze; post-mortem required before resuming
