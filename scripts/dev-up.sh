#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"
RUNTIME_DIR="$ROOT_DIR/.flowstate-runtime"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
WEB_LOG="$LOG_DIR/web.log"
WORKER_LOG="$LOG_DIR/worker.log"
WATCHER_LOG="$LOG_DIR/inbox-watcher.log"
CONNECTOR_PUMP_LOG="$LOG_DIR/connector-pump.log"
REVIEW_ALERTS_LOG="$LOG_DIR/review-alerts.log"
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

read_env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -n 1 | sed -E "s/^${key}=//"
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  if [[ ! -f "$ENV_EXAMPLE_FILE" ]]; then
    print_error "Missing .env and .env.example."
    exit 1
  fi

  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  print_info "Created .env from .env.example"
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

ensure_env_file

OPENAI_API_KEY_VALUE="${OPENAI_API_KEY:-}"
if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  OPENAI_API_KEY_VALUE="$(read_env_value OPENAI_API_KEY || true)"
fi

if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  print_error "OPENAI_API_KEY is not set. Add it to .env or export it in your shell."
  exit 1
fi

FOLDER_WATCHER_ENABLED="$(read_env_value FLOWSTATE_ENABLE_FOLDER_WATCHER || true)"
FOLDER_WATCHER_ENABLED_NORMALIZED="$(printf '%s' "$FOLDER_WATCHER_ENABLED" | tr '[:upper:]' '[:lower:]')"
CONNECTOR_PUMP_ENABLED="$(read_env_value FLOWSTATE_ENABLE_CONNECTOR_PUMP || true)"
CONNECTOR_PUMP_ENABLED_NORMALIZED="$(printf '%s' "$CONNECTOR_PUMP_ENABLED" | tr '[:upper:]' '[:lower:]')"
REVIEW_ALERTS_ENABLED="$(read_env_value FLOWSTATE_ENABLE_REVIEW_ALERTS || true)"
REVIEW_ALERTS_ENABLED_NORMALIZED="$(printf '%s' "$REVIEW_ALERTS_ENABLED" | tr '[:upper:]' '[:lower:]')"

mkdir -p "$LOG_DIR" "$PID_DIR"

start_service \
  "web" \
  "$WEB_PID_FILE" \
  "$WEB_LOG" \
  env FLOWSTATE_EFFECTIVE_OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && export OPENAI_API_KEY=\"\$FLOWSTATE_EFFECTIVE_OPENAI_API_KEY\" && npm run dev --workspace @flowstate/web"

start_service \
  "worker" \
  "$WORKER_PID_FILE" \
  "$WORKER_LOG" \
  env FLOWSTATE_EFFECTIVE_OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && export OPENAI_API_KEY=\"\$FLOWSTATE_EFFECTIVE_OPENAI_API_KEY\" && npm run dev --workspace @flowstate/worker"

if [[ "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "1" || "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "true" || "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "yes" ]]; then
  start_service \
    "inbox-watcher" \
    "$WATCHER_PID_FILE" \
    "$WATCHER_LOG" \
    env FLOWSTATE_EFFECTIVE_OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && export OPENAI_API_KEY=\"\$FLOWSTATE_EFFECTIVE_OPENAI_API_KEY\" && npm run watch:inbox --workspace @flowstate/worker"
fi

if [[ "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "1" || "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "true" || "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "yes" ]]; then
  start_service \
    "connector-pump" \
    "$CONNECTOR_PUMP_PID_FILE" \
    "$CONNECTOR_PUMP_LOG" \
    env FLOWSTATE_EFFECTIVE_OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && export OPENAI_API_KEY=\"\$FLOWSTATE_EFFECTIVE_OPENAI_API_KEY\" && npm run watch:connectors --workspace @flowstate/worker"
fi

if [[ "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "1" || "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "true" || "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "yes" ]]; then
  start_service \
    "review-alerts" \
    "$REVIEW_ALERTS_PID_FILE" \
    "$REVIEW_ALERTS_LOG" \
    env FLOWSTATE_EFFECTIVE_OPENAI_API_KEY="$OPENAI_API_KEY_VALUE" bash -lc "cd '$ROOT_DIR' && set -a && source '$ENV_FILE' && set +a && export OPENAI_API_KEY=\"\$FLOWSTATE_EFFECTIVE_OPENAI_API_KEY\" && npm run watch:review-alerts --workspace @flowstate/worker"
fi

printf "\nFlowstate dev services are running.\n"
printf "  Web URL:      %s\n" "http://localhost:3000"
printf "  Web log:      %s\n" "$WEB_LOG"
printf "  Worker log:   %s\n" "$WORKER_LOG"
if [[ "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "1" || "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "true" || "$FOLDER_WATCHER_ENABLED_NORMALIZED" == "yes" ]]; then
  printf "  Watcher log:  %s\n" "$WATCHER_LOG"
fi
if [[ "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "1" || "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "true" || "$CONNECTOR_PUMP_ENABLED_NORMALIZED" == "yes" ]]; then
  printf "  Pump log:     %s\n" "$CONNECTOR_PUMP_LOG"
fi
if [[ "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "1" || "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "true" || "$REVIEW_ALERTS_ENABLED_NORMALIZED" == "yes" ]]; then
  printf "  Alerts log:   %s\n" "$REVIEW_ALERTS_LOG"
fi
printf "  Stop command: %s\n" "scripts/dev-down.sh"
