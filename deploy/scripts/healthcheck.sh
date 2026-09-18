#!/usr/bin/env bash
# ==============================================================================
# Agentic Deployment Healthcheck & Smoke Test
# ==============================================================================

set -euo pipefail

API_URL="${1:-http://localhost:4000/health}"
WEB_URL="${2:-http://localhost:3000}"
MAX_RETRIES=6
RETRY_DELAY=5

echo "🩺 Probing deployment health..."

# 1. Probe API Health Endpoint
for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: Checking API at ${API_URL}..."
  HTTP_STATUS=$(curl -s -o /tmp/health_resp.json -w "%{http_code}" "${API_URL}" || true)

  if [ "$HTTP_STATUS" -eq 200 ]; then
    DB_STATUS=$(jq -r '.database.status' /tmp/health_resp.json 2>/dev/null || echo "unknown")
    if [ "$DB_STATUS" = "ok" ]; then
      echo "✅ API and Database are healthy!"
      cat /tmp/health_resp.json | jq .
      break
    fi
  fi

  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "❌ API Health check failed after $MAX_RETRIES attempts (Last HTTP status: $HTTP_STATUS)"
    if [ -f /tmp/health_resp.json ]; then
      cat /tmp/health_resp.json
    fi
    exit 1
  fi

  sleep $RETRY_DELAY
done

# 2. Probe Web Dashboard
echo "Checking Web Dashboard at ${WEB_URL}..."
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${WEB_URL}" || true)
if [ "$WEB_STATUS" -ge 200 ] && [ "$WEB_STATUS" -lt 400 ]; then
  echo "✅ Web UI is responsive (HTTP $WEB_STATUS)."
else
  echo "❌ Web UI responded with HTTP $WEB_STATUS"
  exit 1
fi

echo "🎉 All smoke tests passed successfully!"
exit 0
