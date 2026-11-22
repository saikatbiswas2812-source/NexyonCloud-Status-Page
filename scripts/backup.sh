#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP="$(date +%F_%H-%M-%S)"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_PATH:-status.db}" ".backup 'backups/status-${STAMP}.db'"
else
  cp "${DB_PATH:-status.db}" "backups/status-${STAMP}.db"
fi
find backups -type f -name 'status-*.db' -mtime +14 -delete
echo "Backup created: backups/status-${STAMP}.db"
