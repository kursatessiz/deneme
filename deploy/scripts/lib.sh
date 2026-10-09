#!/usr/bin/env bash
# Shared helpers for the server-side scripts. Sourced, not executed.

APP_DIR="${APP_DIR:-/opt/app}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.prod.yml}"
RELEASE_DIR="${APP_DIR}/releases"
LOGFILE="${LOGFILE:-${APP_DIR}/deploy.log}"

log() {
  # A closed stderr (dropped SSH session) must never abort a running deployment.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOGFILE}" >&2 || true
}

load_env() {
  if [ -f "${APP_DIR}/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "${APP_DIR}/.env"
    set +a
  fi
  : "${IMAGE_REPO:?IMAGE_REPO must be set in ${APP_DIR}/.env}"
}

compose() {
  docker compose --project-directory "${APP_DIR}" -f "${COMPOSE_FILE}" "$@"
}

use_release() {
  export RELEASE_TAG="$1"
  export API_IMAGE="${IMAGE_REPO}/api:${RELEASE_TAG}"
  export WEB_IMAGE="${IMAGE_REPO}/web:${RELEASE_TAG}"
}

current_release() {
  cat "${RELEASE_DIR}/current" 2>/dev/null || true
}

# Remove old release images. `docker image prune -a` cannot be used alone: the
# previous release has no running container, so it would be deleted once it is
# older than the filter and a rollback would need a registry pull. Instead the
# api and web tags of IMAGE_REPO are listed newest first; the newest KEEP
# (default 3), the current release and the previous release are kept and the
# rest are removed. Images still used by a container are refused by docker rm.
prune_release_images() {
  local keep="${KEEP_RELEASE_IMAGES:-3}" name ref tag count current previous
  current="$(current_release)"
  previous="$(cat "${RELEASE_DIR}/previous" 2>/dev/null || true)"
  for name in api web; do
    count=0
    while IFS= read -r ref; do
      [ -n "${ref}" ] || continue
      count=$((count + 1))
      tag="${ref##*:}"
      if [ "${count}" -le "${keep}" ] || [ "${tag}" = "${current}" ] || [ "${tag}" = "${previous}" ]; then
        continue
      fi
      docker image rm "${ref}" >/dev/null 2>&1 || true
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "${IMAGE_REPO}/${name}" 2>/dev/null || true)
  done
  docker image prune -f >/dev/null 2>&1 || true
}
