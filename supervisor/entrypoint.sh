#!/usr/bin/env bash
# Layer-2 supervisor (ARCHITECTURE.md §3, §13): sync self-written tools,
# Obsidian Headless sidecar, regenerate the tool registry, run the bot,
# honour exit codes, quarantine crash-loops.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
DATA_DIR="${DATA_DIR:-/data}"
TOOLS_SRC="${DATA_DIR}/tools"
TOOLS_GEN="${APP_DIR}/lib/src/tools/generated"
QUARANTINE="${TOOLS_SRC}/quarantine"
STATE_DIR="${DATA_DIR}/state"
CRASH_LOG="${STATE_DIR}/crash_times"
LAST_GOOD="${STATE_DIR}/last_good_boot"
VAULT_DIR="${OBSIDIAN_VAULT_DIR:-${DATA_DIR}/vault}"
VAULT_STATUS="${STATE_DIR}/vault_status"
# Persist Obsidian Headless login/config under the data volume.
export HOME="${DATA_DIR}/obsidian"
OB_SIDECAR_PIDFILE="${STATE_DIR}/ob_sync.pid"
OB_SIDECAR_LOG="${STATE_DIR}/ob_sync.log"

cd "$APP_DIR"

mkdir -p "$TOOLS_SRC" "$QUARANTINE" "$STATE_DIR" "$TOOLS_GEN" "$HOME" "$VAULT_DIR"

backoff=5
max_backoff=300

sync_tools() {
  # Drop previously synced tools (keep .gitkeep and private staging files).
  find "$TOOLS_GEN" -maxdepth 1 -type f -name '*_tool.dart' ! -name '_*' -delete
  if compgen -G "${TOOLS_SRC}/*_tool.dart" > /dev/null; then
    for f in "${TOOLS_SRC}"/*_tool.dart; do
      base="$(basename "$f")"
      case "$base" in
        _*) continue ;;
      esac
      cp -f "$f" "${TOOLS_GEN}/${base}"
    done
  fi
}

generate_registry() {
  dart run tool/generate_tool_registry.dart
}

record_crash() {
  local now
  now="$(date +%s)"
  echo "$now" >> "$CRASH_LOG"
  if [[ -f "$CRASH_LOG" ]]; then
    tail -n 20 "$CRASH_LOG" > "${CRASH_LOG}.tmp"
    mv "${CRASH_LOG}.tmp" "$CRASH_LOG"
  fi
}

crash_count_in_window() {
  local window_start now count
  now="$(date +%s)"
  window_start=$((now - 600))
  count=0
  if [[ -f "$CRASH_LOG" ]]; then
    while read -r ts; do
      [[ -z "$ts" ]] && continue
      if (( ts >= window_start )); then
        count=$((count + 1))
      fi
    done < "$CRASH_LOG"
  fi
  echo "$count"
}

newest_tool() {
  local newest=""
  if compgen -G "${TOOLS_SRC}/*_tool.dart" > /dev/null; then
    # shellcheck disable=SC2012
    newest="$(ls -1t "${TOOLS_SRC}"/*_tool.dart 2>/dev/null | head -n 1 || true)"
  fi
  echo "$newest"
}

maybe_quarantine() {
  local crashes newest base tool_mtime good_ts
  crashes="$(crash_count_in_window)"
  if (( crashes < 3 )); then
    return 0
  fi

  newest="$(newest_tool)"
  if [[ -z "$newest" ]]; then
    echo "Crash loop detected but no tools to quarantine."
    return 0
  fi

  if [[ -f "$LAST_GOOD" ]]; then
    good_ts="$(date -u -d "$(cat "$LAST_GOOD")" +%s 2>/dev/null || echo 0)"
    tool_mtime="$(stat -c %Y "$newest" 2>/dev/null || echo 0)"
    if (( tool_mtime <= good_ts )); then
      echo "Crash loop detected but newest tool is not newer than last good boot — not quarantining."
      return 0
    fi
  fi

  base="$(basename "$newest")"
  echo "Quarantining ${base} after ${crashes} crashes in 10 minutes."
  mv -f "$newest" "${QUARANTINE}/${base}"
  printf '%s' "${base%_tool.dart}" > "${QUARANTINE}/.last_quarantined"
  : > "$CRASH_LOG"
}

ob_sidecar_running() {
  if [[ ! -f "$OB_SIDECAR_PIDFILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$OB_SIDECAR_PIDFILE")"
  kill -0 "$pid" 2>/dev/null
}

# Idempotent Obsidian Headless setup + continuous sync sidecar (§13).
# Failed login/setup is non-fatal (vault_status=unavailable). When credentials
# are omitted, the local vault directory stays usable without Sync.
setup_obsidian() {
  if [[ -z "${OBSIDIAN_EMAIL:-}" || -z "${OBSIDIAN_PASSWORD:-}" || -z "${OBSIDIAN_VAULT_NAME:-}" ]]; then
    echo "OBSIDIAN_* credentials not fully set — local vault only (no Sync)."
    printf 'ready' > "$VAULT_STATUS"
    return 0
  fi

  if ! command -v ob >/dev/null 2>&1; then
    echo "ob (obsidian-headless) not installed — vault sync unavailable."
    printf 'unavailable' > "$VAULT_STATUS"
    return 0
  fi

  set +e
  ob login --email "$OBSIDIAN_EMAIL" --password "$OBSIDIAN_PASSWORD"
  login_code=$?
  set -e
  if [[ "$login_code" -ne 0 ]]; then
    echo "ob login failed (exit ${login_code}) — vault sync unavailable."
    printf 'unavailable' > "$VAULT_STATUS"
    return 0
  fi

  set +e
  if [[ -n "${OBSIDIAN_E2EE_PASSWORD:-}" ]]; then
    ob sync-setup --path "$VAULT_DIR" --vault "$OBSIDIAN_VAULT_NAME" \
      --password "$OBSIDIAN_E2EE_PASSWORD" --device-name "egon-bot"
  else
    ob sync-setup --path "$VAULT_DIR" --vault "$OBSIDIAN_VAULT_NAME" \
      --device-name "egon-bot"
  fi
  setup_code=$?
  set -e
  if [[ "$setup_code" -ne 0 ]]; then
    echo "ob sync-setup failed (exit ${setup_code}) — vault sync unavailable."
    printf 'unavailable' > "$VAULT_STATUS"
    return 0
  fi

  printf 'ready' > "$VAULT_STATUS"
  ensure_obsidian_sidecar
}

ensure_obsidian_sidecar() {
  if [[ ! -f "$VAULT_STATUS" ]] || [[ "$(cat "$VAULT_STATUS")" != "ready" ]]; then
    return 0
  fi
  if ob_sidecar_running; then
    return 0
  fi

  echo "Starting ob sync --continuous for ${VAULT_DIR}"
  (
    # Restart the sidecar independently of the bot process.
    local delay=5
    while true; do
      set +e
      ob sync --path "$VAULT_DIR" --continuous >>"$OB_SIDECAR_LOG" 2>&1
      code=$?
      set -e
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ob sync exited ${code}; restarting in ${delay}s" >>"$OB_SIDECAR_LOG"
      sleep "$delay"
      if (( delay < 60 )); then
        delay=$((delay * 2))
        if (( delay > 60 )); then delay=60; fi
      fi
    done
  ) &
  echo $! > "$OB_SIDECAR_PIDFILE"
}

# Daily SQLite backup (§17). Prefer an online copy from a healthy DB; this
# shell copy is a best-effort fallback before the bot process starts.
rotate_db_backup() {
  local db="${DATA_DIR}/egon.db"
  local bak="${STATE_DIR}/egon.db.bak"
  local marker="${STATE_DIR}/egon.db.bak.date"
  local today
  today="$(date -u +%Y-%m-%d)"
  if [[ ! -f "$db" ]]; then
    return 0
  fi
  if [[ -f "$marker" ]] && [[ "$(cat "$marker")" == "$today" ]]; then
    return 0
  fi
  cp -f "$db" "$bak"
  # Best-effort WAL companions (may be absent).
  [[ -f "${db}-wal" ]] && cp -f "${db}-wal" "${bak}-wal" || true
  [[ -f "${db}-shm" ]] && cp -f "${db}-shm" "${bak}-shm" || true
  printf '%s' "$today" > "$marker"
  echo "Rotated daily SQLite backup → ${bak}"
}

# One-time Obsidian setup before the bot loop.
setup_obsidian

while true; do
  # Keep the sync sidecar alive across bot restarts.
  ensure_obsidian_sidecar
  rotate_db_backup

  sync_tools
  generate_registry

  if ! dart pub get --offline; then
    dart pub get
  fi

  set +e
  dart run bin/main.dart
  code=$?
  set -e

  echo "Bot exited with code ${code}."

  if [[ "$code" -eq 0 ]]; then
    echo "Clean shutdown — supervisor exiting."
    if ob_sidecar_running; then
      kill "$(cat "$OB_SIDECAR_PIDFILE")" 2>/dev/null || true
    fi
    exit 0
  fi

  if [[ "$code" -eq 42 ]]; then
    echo "Restart requested — restarting immediately."
    backoff=5
    continue
  fi

  record_crash
  maybe_quarantine

  echo "Crash — backing off ${backoff}s before restart."
  sleep "$backoff"
  if (( backoff < max_backoff )); then
    next=$((backoff * 2))
    if (( next > max_backoff )); then
      next=$max_backoff
    fi
    backoff=$next
  fi
done
