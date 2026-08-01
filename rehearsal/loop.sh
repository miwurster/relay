#!/bin/sh
# Runs every scenario against both landings, N rounds, one after another.
# usage: rehearsal/loop.sh [rounds]   (default 3)
# Each pass is ~20-35 min, so a 3-round loop is the better part of a day.
# Digests land in rehearsal/runs/; this log is the only extra artefact.
set -u

rounds=${1:-3}
cd "$(dirname "$0")/.." || exit 2
log="rehearsal/runs/loop-$(date -u +%Y-%m-%dT%H-%M-%S).log"

started=$(date -u +%FT%TZ)
round=1
while [ "$round" -le "$rounds" ]; do
  for scenario in happy-path bug-report single-spec; do
    for landing in merge pull-request; do
      echo "=== round $round | $scenario | $landing | $(date -u +%FT%TZ) ==="
      npm run rehearse -- "$scenario" "$landing"
      echo "=== exit $? ==="
    done
  done
  round=$((round + 1))
done 2>&1 | tee "$log"

echo
echo "loop: log in $log"
echo "loop: digests since $started:"
find rehearsal/runs -name '*.txt' -newermt "$started" | sort
