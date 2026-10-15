#!/bin/sh
set -eu
# Uses Claude's SSD verification supplied by the user, 2026-10-15 22:02:30 rc=0.
# Does not call diskutil or ssd-workspace check/run (run also calls diskutil).
exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/prepare-run.mjs" "$@"
