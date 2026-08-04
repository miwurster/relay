#!/bin/sh
# Runs all three scenarios under `merge`, then all three under `pull-request`, N rounds.
# usage: rehearsal/loop.sh [rounds]   (default 3)
# Each pass is ~20-35 min, so a 3-round loop is the better part of a day.
# Digests and their records land in rehearsal/runs/; this log is the only extra artefact.
# The stamp file is what the digests of this loop are told apart by: `find -newermt`
# reads an ISO instant on GNU and refuses one on BSD, so a file's mtime is the
# portable reference.
set -u

rounds=${1:-3}
cd "$(dirname "$0")/.." || exit 2
log="rehearsal/runs/loop-$(date -u +%Y-%m-%dT%H-%M-%S).log"

stamp=$(mktemp)
round=1
while [ "$round" -le "$rounds" ]; do
  for landing in merge pull-request; do
    for scenario in happy-path bug-report single-spec; do
      echo "=== round $round | $scenario | $landing | $(date -u +%FT%TZ) ==="
      npm run rehearse -- "$scenario" "$landing"
      echo "=== exit $? ==="
    done
  done
  round=$((round + 1))
done 2>&1 | tee "$log"

echo
echo "loop: log in $log"
echo "loop: digests from this loop:"
find rehearsal/runs -name '*.txt' -newer "$stamp" | sort
rm -f "$stamp"
