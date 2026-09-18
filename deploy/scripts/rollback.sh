#!/usr/bin/env bash
# ==============================================================================
# Automated Rollback Script
# ==============================================================================

set -euo pipefail

PREV_TAG="${1:?Previous release tag must be provided as argument}"
APP_DIR="/opt/pilates-studio"

echo "⚠️ INITIATING AUTOMATED ROLLBACK TO: ${PREV_TAG}..."

cd "${APP_DIR}"

export API_IMAGE="ghcr.io/${GITHUB_REPOSITORY:-your-org/pilates-studio}/api:${PREV_TAG}"
export WEB_IMAGE="ghcr.io/${GITHUB_REPOSITORY:-your-org/pilates-studio}/web:${PREV_TAG}"

echo "1. Pulling previous images..."
docker compose -f docker-compose.prod.yml pull api web

echo "2. Restarting services with previous release..."
docker compose -f docker-compose.prod.yml up -d --no-deps api web

echo "3. Verifying rollback health..."
sleep 10
bash ./scripts/healthcheck.sh

echo "✅ Rollback completed successfully to version: ${PREV_TAG}."
