#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.flowstate-runtime"
PID_DIR="$RUNTIME_DIR/pids"
WEB_PID_FILE="$PID_DIR/web.pid"
WORKER_PID_FILE="$PID_DIR/worker.pid"
WATCHER_PID_FILE="$PID_DIR/inbox-watcher.pid"
CONNECTOR_PUMP_PID_FILE="$PID_DIR/connector-pump.pid"
REVIEW_ALERTS_PID_FILE="$PID_DIR/review-alerts.pid"

print_info() {
  printf "\033[36m%s\033[0m\n" "$1"
}

stop_service() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    print_info "$name is not running"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    print_info "$name had stale pid file, cleaned"
    return
  fi

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    print_info "$name already stopped"
    return
  fi

  kill "$pid" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$pid_file"
      print_info "$name stopped"
      return
    fi

    sleep 0.25
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
  rm -f "$pid_file"
  print_info "$name force-stopped"
}

stop_service "web" "$WEB_PID_FILE"
stop_service "worker" "$WORKER_PID_FILE"
stop_service "inbox-watcher" "$WATCHER_PID_FILE"
stop_service "connector-pump" "$CONNECTOR_PUMP_PID_FILE"
stop_service "review-alerts" "$REVIEW_ALERTS_PID_FILE"

print_info "Flowstate dev services are stopped"
