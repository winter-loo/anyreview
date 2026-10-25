#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-2067}"

cat <<INFO
Starting AnyReview
  app:  $script_dir
  bind: $HOST:$PORT
INFO

exec node "$script_dir/build"
