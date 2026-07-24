# 12 — Quality-gate role + loop

**What to build:** Replace the gate stub with the real role. It runs the repo's green-gate command string (relay is build-tool-agnostic — runs it, reads the exit code) covering all test tiers except e2e (migration + integration included), then triages the result. The harness drives a quality-gate → fixer loop capped at 2 iterations: converge to green, or give up after two and fall through to the blocked handover. Only this objective gate loops — the subjective review roles run once.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] Runs the configured green-gate command string; reads exit code, build-tool-agnostic
- [ ] Gate covers all tiers except e2e (migration + integration in)
- [ ] Triages the result and reports pass/fail with detail
- [ ] Gate → fixer loop capped at 2; non-green after 2 → blocked outcome
- [ ] Per-role model map applied (gate: sonnet)
