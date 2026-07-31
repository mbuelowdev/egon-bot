#!/usr/bin/env bash
# Layer-2 supervisor (ARCHITECTURE.md §3): sync self-written tools, regenerate
# the tool registry, run the bot, honour exit codes, quarantine crash-loops.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
DATA_DIR="${DATA_DIR:-/data}"
TOOLS_SRC="${DATA_DIR}/tools"
TOOLS_GEN="${APP_DIR}/lib/src/tools/generated"
QUARANTINE="${TOOLS_SRC}/quarantine"
STATE_DIR="${DATA_DIR}/state"
CRASH_LOG="${STATE_DIR}/crash_times"
LAST_GOOD="${STATE_DIR}/last_good_boot"

cd "$APP_DIR"

mkdir -p "$TOOLS_SRC" "$QUARANTINE" "$STATE_DIR" "$TOOLS_GEN"

backoff=5
max_backoff=300

sync_tools() {
  # Drop previously synced tools (keep .gitkeep and private staging files).
  find "$TOOLS_GEN" -maxdepth 1 -type f -name '*_tool.dart' ! -name '_*' -delete
  if compgen -G "${TOOLS_SRC}/*_tool.dart" > /dev/null; then
    for f in "${TOOLS_SRC}"/*_tool.dart; do
      base="$(basename "$f")"
      # Skip private / staging names.
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
  # Keep only the last 20 crash timestamps.
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
  # Newest non-private *_tool.dart under /data/tools by mtime.
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

  # Only quarantine when a tool file is newer than the last healthy boot
  # (written by the bot after Discord connects).
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
  # Marker consumed by NoticeService on the next successful boot.
  printf '%s' "${base%_tool.dart}" > "${QUARANTINE}/.last_quarantined"
  # Reset crash window so we don't immediately quarantine another file.
  : > "$CRASH_LOG"
}

while true; do
  sync_tools
  generate_registry

  # Offline-first pub get; fall back to network if the cache is cold.
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
    exit 0
  fi

  if [[ "$code" -eq 42 ]]; then
    echo "Restart requested — restarting immediately."
    backoff=5
    # A deliberate restart is not a crash; keep last-good markers.
    continue
  fi

  # Crash path.
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
