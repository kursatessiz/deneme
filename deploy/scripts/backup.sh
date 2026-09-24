#!/usr/bin/env bash
# PostgreSQL dump with 14-day local rotation.
# Off-site copy to object storage is tracked in backlog 6.1.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/lib.sh
. "${SCRIPT_DIR}/lib.sh"
load_env

BACKUP_DIR="${APP_DIR}/backups"
FILENAME="${BACKUP_DIR}/db_$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

log "Starting database backup"
# shellcheck disable=SC2016 # expanded inside the container
if compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "${FILENAME}"; then
  chmod 600 "${FILENAME}"
  log "Backup written: ${FILENAME} ($(du -h "${FILENAME}" | cut -f1))"
else
  rm -f "${FILENAME}"
  log "Backup FAILED"
  exit 1
fi

find "${BACKUP_DIR}" -name 'db_*.sql.gz' -type f -mtime +14 -delete
