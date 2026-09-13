#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

default_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
default_ip=${default_ip:-127.0.0.1}

export REVIEW_PLATFORM_HOME="${REVIEW_PLATFORM_HOME:-$HOME/.review-platform}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-2067}"
export REVIEW_PLATFORM_BASE_URL="${REVIEW_PLATFORM_BASE_URL:-http://${default_ip}:${PORT}}"

mkdir -p "$REVIEW_PLATFORM_HOME"

cat <<INFO
Starting ReviewLoop
  app:  $script_dir
  home: $REVIEW_PLATFORM_HOME
  url:  $REVIEW_PLATFORM_BASE_URL
  bind: $HOST:$PORT
INFO

exec node "$script_dir/build"
