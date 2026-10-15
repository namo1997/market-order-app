#!/bin/sh
# Explicitly reuse Claude's supplied SSD receipt; never invoke diskutil/check here.
# Usage: sh server/scripts/start-test-mysql-on-ssd.sh --ssd-verified-by-claude
# Starts a disposable socket-only MySQL, runs two integration and regression rounds,
# and stops only the child it started. All generated files remain on the SSD.
set -eu
ulimit -c 0
if [ "${1-}" != '--ssd-verified-by-claude' ] || [ "$#" -ne 1 ]; then
  echo 'Requires --ssd-verified-by-claude after an operator has verified SSD identity.' >&2
  exit 2
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec node "$SCRIPT_DIR/run-receiving-mysql-it.mjs"
