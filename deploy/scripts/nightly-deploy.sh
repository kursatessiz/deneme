#!/usr/bin/env bash
# ==============================================================================
# Pilates Studio OS - 100% Free Self-Hosted Nightly CI/CD Script
# Runs at 03:00 AM via Crontab (or triggered manually)
# Zero external tools, Zero cost, 6GB RAM optimized sequential build & auto-rollback
# ==============================================================================

set -euo pipefail

APP_DIR="/opt/pilates-studio"
LOGFILE="${APP_DIR}/deploy.log"
BRANCH="main"

mkdir -p "${APP_DIR}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOGFILE}"
}

log "======================================================================"
log "🌙 Starting Nightly Deployment Check for Pilates Studio OS..."
log "======================================================================"

cd "${APP_DIR}"

# 1. Check if git repository exists
if [ ! -d ".git" ]; then
  log "❌ Git directory not found in ${APP_DIR}!"
  exit 1
fi

# 2. Check for Remote Git Updates
log "🔍 Checking for new git commits on '${BRANCH}'..."
git fetch origin "${BRANCH}"

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git rev-parse "origin/${BRANCH}")

if [ "${LOCAL_HASH}" = "${REMOTE_HASH}" ]; then
  log "✅ No new updates detected. (Current commit: ${LOCAL_HASH:0:7}). Exiting."
  exit 0
fi

log "🚀 New commits found! (${LOCAL_HASH:0:7} -> ${REMOTE_HASH:0:7})"

# 3. Step 1: Pre-Deploy Database Backup
log "💾 Step 1/5: Taking safety database backup before applying update..."
if [ -f "${APP_DIR}/deploy/scripts/backup.sh" ]; then
  bash "${APP_DIR}/deploy/scripts/backup.sh"
fi

# 4. Step 2: Backup Currently Running Docker Images for Instant Rollback
log "🛡️ Step 2/5: Tagging current active containers as backup..."
docker tag pilates-api:local pilates-api:backup 2>/dev/null || true
docker tag pilates-web:local pilates-web:backup 2>/dev/null || true

# 5. Step 3: Pull Latest Code
log "📥 Step 3/5: Pulling latest changes from git..."
git pull origin "${BRANCH}"

# 6. Step 4: Memory-Conscious Sequential Build (6GB RAM Safety)
# We build API first, then Web to prevent simultaneous RAM spikes!
log "🔨 Step 4/5: Building containers sequentially..."

log "   -> Building NestJS API container..."
docker compose -f deploy/docker-compose.self-hosted.yml build api

log "   -> Building Next.js Web Standalone container..."
docker compose -f deploy/docker-compose.self-hosted.yml build web

# 7. Apply Database Migrations & Restart
log "🔄 Step 5/5: Applying Prisma migrations & rolling container restart..."
docker compose -f deploy/docker-compose.self-hosted.yml run --rm api npx prisma migrate deploy || true
docker compose -f deploy/docker-compose.self-hosted.yml up -d --remove-orphans

# 8. Agentic Smoke Test (Verification)
log "🩺 Probing deployment health..."
sleep 15

if bash "${APP_DIR}/deploy/scripts/healthcheck.sh"; then
  log "🎉 NIGHTLY DEPLOYMENT SUCCEEDED! All services healthy."
  
  # Clean old build cache to preserve 60GB SSD disk space
  log "🧹 Cleaning dangling build caches..."
  docker image prune -f --filter "until=48h"
  exit 0
else
  log "🚨 SMOKE TEST FAILED! INITIATING AUTOMATIC SELF-HEALING ROLLBACK..."
  
  # Rollback to tagged backup images
  docker tag pilates-api:backup pilates-api:local
  docker tag pilates-web:backup pilates-web:local
  docker compose -f deploy/docker-compose.self-hosted.yml up -d --no-deps api web
  
  log "⚠️ System rolled back to previous stable image. Check ${LOGFILE} for details."
  exit 1
fi
