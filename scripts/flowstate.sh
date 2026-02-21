#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.flowstate-runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"
WEB_PID_FILE="$PID_DIR/web.pid"
WORKER_PID_FILE="$PID_DIR/worker.pid"
WATCHER_PID_FILE="$PID_DIR/inbox-watcher.pid"
CONNECTOR_PUMP_PID_FILE="$PID_DIR/connector-pump.pid"
REVIEW_ALERTS_PID_FILE="$PID_DIR/review-alerts.pid"

print_error() {
  printf "\033[31m%s\033[0m\n" "$1" >&2
}

print_info() {
  printf "\033[36m%s\033[0m\n" "$1"
}

is_running() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -z "$pid" ]]; then
    return 1
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

status_line() {
  local name="$1"
  local pid_file="$2"

  if is_running "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    printf "%s: running (pid %s)\n" "$name" "$pid"
  else
    printf "%s: stopped\n" "$name"
  fi
}

show_logs() {
  local service="${1:-all}"
  local tail_lines="${FLOWSTATE_LOG_TAIL_LINES:-120}"

  case "$service" in
    web)
      tail -n "$tail_lines" "$LOG_DIR/web.log"
      ;;
    worker)
      tail -n "$tail_lines" "$LOG_DIR/worker.log"
      ;;
    watcher)
      tail -n "$tail_lines" "$LOG_DIR/inbox-watcher.log"
      ;;
    connector-pump)
      tail -n "$tail_lines" "$LOG_DIR/connector-pump.log"
      ;;
    review-alerts)
      tail -n "$tail_lines" "$LOG_DIR/review-alerts.log"
      ;;
    all)
      print_info "web log"
      tail -n "$tail_lines" "$LOG_DIR/web.log" || true
      printf "\n"
      print_info "worker log"
      tail -n "$tail_lines" "$LOG_DIR/worker.log" || true
      printf "\n"
      print_info "inbox-watcher log"
      tail -n "$tail_lines" "$LOG_DIR/inbox-watcher.log" || true
      printf "\n"
      print_info "connector-pump log"
      tail -n "$tail_lines" "$LOG_DIR/connector-pump.log" || true
      printf "\n"
      print_info "review-alerts log"
      tail -n "$tail_lines" "$LOG_DIR/review-alerts.log" || true
      ;;
    *)
      print_error "Unknown service: $service"
      exit 1
      ;;
  esac
}

usage() {
  cat <<'USAGE'
Flowstate local runtime command.

Usage:
  scripts/flowstate.sh start
  scripts/flowstate.sh stop
  scripts/flowstate.sh restart
  scripts/flowstate.sh status
  scripts/flowstate.sh logs [web|worker|watcher|connector-pump|review-alerts|all]
USAGE
}

COMMAND="${1:-status}"
ARG1="${2:-}"

case "$COMMAND" in
  start)
    bash "$ROOT_DIR/scripts/dev-up.sh"
    ;;
  stop)
    bash "$ROOT_DIR/scripts/dev-down.sh"
    ;;
  restart)
    bash "$ROOT_DIR/scripts/dev-down.sh"
    bash "$ROOT_DIR/scripts/dev-up.sh"
    ;;
  status)
    status_line "web" "$WEB_PID_FILE"
    status_line "worker" "$WORKER_PID_FILE"
    status_line "inbox-watcher" "$WATCHER_PID_FILE"
    status_line "connector-pump" "$CONNECTOR_PUMP_PID_FILE"
    status_line "review-alerts" "$REVIEW_ALERTS_PID_FILE"
    ;;
  logs)
    if [[ ! -d "$LOG_DIR" ]]; then
      print_error "No runtime logs found at $LOG_DIR"
      exit 1
    fi

    show_logs "$ARG1"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    print_error "Unknown command: $COMMAND"
    usage
    exit 1
    ;;
esac
