#!/usr/bin/env bash
# ==============================================================================
# Automated PostgreSQL Backup Script with Rotation
# ==============================================================================

set -euo pipefail

BACKUP_DIR="/opt/pilates-studio/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/pilates_db_${TIMESTAMP}.sql.gz"
LOGFILE="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting DB backup..." >> "${LOGFILE}"

# Load credentials from .env
if [ -f /opt/pilates-studio/.env ]; then
  export $(grep -v '^#' /opt/pilates-studio/.env | xargs)
fi

DB_USER="${POSTGRES_USER:-pilates_admin}"
DB_NAME="${POSTGRES_DB:-pilates_prod}"

# Run pg_dump inside docker container
if docker exec pilates_postgres pg_dump -U "${DB_USER}" -d "${DB_NAME}" | gzip -9 > "${FILENAME}"; then
  FILESIZE=$(du -h "${FILENAME}" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Backup successful: ${FILENAME} (${FILESIZE})" >> "${LOGFILE}"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Backup FAILED!" >> "${LOGFILE}"
  exit 1
fi

# Rotate backups: delete backups older than 14 days
find "${BACKUP_DIR}" -name "pilates_db_*.sql.gz" -type f -mtime +14 -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🧹 Purged backups older than 14 days." >> "${LOGFILE}"
