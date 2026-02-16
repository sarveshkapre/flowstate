#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RUNTIME_DIR="$ROOT_DIR/.flowstate-runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
WEB_LOG="$LOG_DIR/web.log"
WORKER_LOG="$LOG_DIR/worker.log"
WEB_PID_FILE="$PID_DIR/web.pid"
WORKER_PID_FILE="$PID_DIR/worker.pid"

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

  rm -f "$pid_file"
  return 1
}

start_service() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if is_running "$pid_file"; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    print_info "$name already running (pid $existing_pid)"
    return
  fi

  printf "\n[%s] Starting at %s\n" "$name" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$log_file"

  nohup "$@" >> "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"

  sleep 1

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    print_error "$name failed to start. Check $log_file"
    tail -n 40 "$log_file" >&2 || true
    rm -f "$pid_file"
    exit 1
  fi

  print_info "$name started (pid $pid)"
}

if [[ ! -f "$ENV_FILE" ]]; then
  print_error "Missing .env. Run scripts/setup-mac.sh first."
  exit 1
fi

OPENAI_API_KEY_VALUE="$(grep -E '^OPENAI_API_KEY=' "$ENV_FILE" | head -n 1 | sed -E 's/^OPENAI_API_KEY=//' || true)"
if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  print_error "OPENAI_API_KEY is not set in .env"
  exit 1
fi

mkdir -p "$LOG_DIR" "$PID_DIR"

start_service \
  "web" \
  "$WEB_PID_FILE" \
  "$WEB_LOG" \
  bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && npm run dev --workspace @flowstate/web"

start_service \
  "worker" \
  "$WORKER_PID_FILE" \
  "$WORKER_LOG" \
  bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && npm run dev --workspace @flowstate/worker"

printf "\nFlowstate dev services are running.\n"
printf "  Web URL:      %s\n" "http://localhost:3000"
printf "  Web log:      %s\n" "$WEB_LOG"
printf "  Worker log:   %s\n" "$WORKER_LOG"
printf "  Stop command: %s\n" "scripts/dev-down.sh"
