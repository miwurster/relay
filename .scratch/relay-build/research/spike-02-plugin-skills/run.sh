#!/usr/bin/env bash
# PROTOTYPE — throwaway. Spike 02: do real kipu-* PLUGIN (marketplace) skills fire
# headless in-sandbox under `claude --print -p`?  Two delivery paths, two invocation
# shapes, run inside the CI-parity sandcastle image. Two-way evidence per run:
#   (1) a `Skill` tool_use event naming the skill in stream-json, and
#   (2) effect — a real git commit lands in the throwaway repo.
#
# One command:  bash run.sh
set -uo pipefail

SPIKE="$(cd "$(dirname "$0")" && pwd)"
OUT="$SPIKE/out"
IMAGE="sandcastle:qc-catalog"
MODEL="claude-haiku-4-5-20251001"
: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}"

mkdir -p "$OUT"

CAP_PROMPT="I have staged some changes. Write a Conventional Commits message following semantic-release conventions for them, then commit it."
NAME_PROMPT="Use the kipu-commit skill to commit the staged changes."

# In-container script: build a fresh throwaway repo with one staged change, run claude
# headless streaming to /out/stream-$CASE.jsonl, then dump the resulting git log.
container_script() {
  local case="$1" prompt="$2" plugin_flag="$3"
  cat <<EOF
set -e
export HOME=/home/agent
mkdir -p /work && cd /work
rm -rf /work/* /work/.git 2>/dev/null || true
git init -q
git config user.email spike@relay.test
git config user.name  Spike
printf 'v1\n' > app.txt
git add app.txt
git commit -qm 'chore: seed'
printf 'v2 — the change to be committed\n' >> app.txt
git add app.txt
echo "=== staged before ===" ; git --no-pager diff --cached --stat
set +e
claude --print --output-format stream-json --verbose \
  --permission-mode bypassPermissions --model $MODEL $plugin_flag \
  "$prompt" > /out/stream-$case.jsonl 2> /out/err-$case.txt
echo "claude exit: \$?"
echo "=== git log after ===" ; git --no-pager log --oneline
git --no-pager log --oneline > /out/effect-$case.txt
EOF
}

run_case() {
  local case="$1" prompt="$2" delivery="$3"
  echo; echo "######## CASE: $case ($delivery) ########"
  local mounts=(-e ANTHROPIC_API_KEY -v "$OUT:/out")
  local plugin_flag=""
  case "$delivery" in
    plugin)   mounts+=(-v "$SPIKE/plugin:/mnt/plugin:ro"); plugin_flag="--plugin-dir /mnt/plugin" ;;
    personal) mounts+=(-v "$SPIKE/plugin/skills/kipu-commit:/home/agent/.claude/skills/kipu-commit:ro") ;;
  esac
  docker run --rm "${mounts[@]}" --entrypoint bash "$IMAGE" \
    -c "$(container_script "$case" "$prompt" "$plugin_flag")"
}

run_case plugin-capability   "$CAP_PROMPT"  plugin
run_case plugin-byname       "$NAME_PROMPT" plugin
run_case personal-capability "$CAP_PROMPT"  personal
run_case personal-byname     "$NAME_PROMPT" personal

echo; echo "######## SUMMARY — Skill tool_use events + commit effect ########"
for c in plugin-capability plugin-byname personal-capability personal-byname; do
  echo "--- $c ---"
  grep -o '"name":"Skill"[^}]*}[^}]*}' "$OUT/stream-$c.jsonl" 2>/dev/null | head -1 \
    || echo "  (no Skill tool_use found)"
  echo "  commits: $(wc -l < "$OUT/effect-$c.txt" 2>/dev/null | tr -d ' ') -> newest: $(head -1 "$OUT/effect-$c.txt" 2>/dev/null)"
done
