#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"
RUNTIME_DIR="$ROOT_DIR/.flowstate-runtime"

print_error() {
  printf "\033[31m%s\033[0m\n" "$1" >&2
}

print_info() {
  printf "\033[36m%s\033[0m\n" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    print_error "Missing required command: $1"
    exit 1
  fi
}

read_env_value() {
  local key="$1"

  if [[ ! -f "$ENV_FILE" ]]; then
    return
  fi

  grep -E "^${key}=" "$ENV_FILE" | head -n 1 | sed -E "s/^${key}=//"
}

resolve_local_path() {
  local raw="$1"

  if [[ "$raw" == ~/* ]]; then
    printf "%s/%s" "$HOME" "${raw#~/}"
    return
  fi

  if [[ "$raw" == /* ]]; then
    printf "%s" "$raw"
    return
  fi

  printf "%s/%s" "$ROOT_DIR" "$raw"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  print_error "setup-mac.sh is intended for macOS only."
  exit 1
fi

print_info "Preparing Flowstate local environment on macOS..."

require_command node
require_command npm
require_command git

NODE_VERSION_RAW="$(node -v)"
NODE_MAJOR="${NODE_VERSION_RAW#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 22 ]]; then
  print_error "Node.js >= 22 is required. Found: $NODE_VERSION_RAW"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
  print_info "Created .env from .env.example"
fi

OPENAI_API_KEY_VALUE="$(read_env_value OPENAI_API_KEY || true)"
if [[ -z "$OPENAI_API_KEY_VALUE" ]]; then
  print_error "OPENAI_API_KEY is not set in $ENV_FILE"
  printf "Set it, then rerun: scripts/setup-mac.sh\n" >&2
  exit 1
fi

print_info "Installing dependencies..."
npm -C "$ROOT_DIR" install

FLOWSTATE_DATA_DIR_VALUE="$(read_env_value FLOWSTATE_DATA_DIR || true)"
if [[ -n "$FLOWSTATE_DATA_DIR_VALUE" ]]; then
  DATA_DIR="$(resolve_local_path "$FLOWSTATE_DATA_DIR_VALUE")"
else
  DATA_DIR="$ROOT_DIR/.flowstate-data"
fi

WATCH_DIR="$(resolve_local_path "$(read_env_value FLOWSTATE_WATCH_DIR || echo "~/Flowstate/inbox")")"
WATCH_ARCHIVE_DIR="$(resolve_local_path "$(read_env_value FLOWSTATE_WATCH_ARCHIVE_DIR || echo "~/Flowstate/archive")")"
WATCH_ERROR_DIR="$(resolve_local_path "$(read_env_value FLOWSTATE_WATCH_ERROR_DIR || echo "~/Flowstate/error")")"

mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/snapshots" "$DATA_DIR/edge-bundles"
mkdir -p "$RUNTIME_DIR/logs" "$RUNTIME_DIR/pids"
mkdir -p "$WATCH_DIR" "$WATCH_ARCHIVE_DIR" "$WATCH_ERROR_DIR"

print_info "Setup complete."
printf "\nNext steps:\n"
printf "  1. Start services: %s\n" "scripts/dev-up.sh"
printf "  2. Stop services:  %s\n" "scripts/dev-down.sh"
printf "  3. Open app:       %s\n" "http://localhost:3000"
printf "  4. Drop files in:  %s\n" "$WATCH_DIR"
