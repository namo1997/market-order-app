#!/bin/sh
set -eu
ulimit -c 0
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec node "$SCRIPT_DIR/start-server.mjs" "$@"
