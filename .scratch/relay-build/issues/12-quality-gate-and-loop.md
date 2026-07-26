# 12 — Quality-gate role + loop

**What to build:** Replace the gate stub with the real role. It runs the repo's green-gate command string (relay is build-tool-agnostic — runs it, reads the exit code) covering all test tiers except e2e (migration + integration included), then triages the result. The harness drives a quality-gate → fixer loop capped at 2 iterations: converge to green, or give up after two and fall through to the blocked handover. Only this objective gate loops — the subjective review roles run once.

**Blocked by:** 11

**Status:** resolved

- [x] Runs the configured green-gate command string; reads exit code, build-tool-agnostic
- [x] Gate covers all tiers except e2e (migration + integration in)
- [x] Triages the result and reports pass/fail with detail
- [x] Gate → fixer loop capped at 2; non-green after 2 → blocked outcome
- [x] Per-role model map applied (gate: sonnet)

## Answer

`src/green-gate.ts` (the role), `src/resources/green-gate.md` (its triage prompt), `src/crew.ts` (the wiring and the `greenGate(attempt)` signature), `src/harness.ts` (the loop's numbering), `src/run-role.ts` (the `no-commits` branch rule), `src/config.ts` (what the gate command must cover).

**The exit code is relay's, the diagnosis is a model's.**
Build-tool-agnostic means relay runs the repo's string and reads `exitCode` — nothing about the output is parsed, so a green run needs no judgement and costs no agent leg at all.
A red run is where a model earns its keep: one cold session on `models.greenGate` (sonnet) reads what failed and returns the one description the fixer acts on.

**The triage sees the tail of the run, not the run.**
A full suite prints far more than a prompt can hold and puts what failed at the end, so the leg is handed the last `GATE_OUTPUT_TAIL` characters of stdout + stderr, told the output is truncated, and told to find the rest in the worktree itself.
Truncating is not parsing: relay still never reads meaning out of those characters.

**"All tiers except e2e" is the repo's promise, not relay's check.**
relay cannot know what tiers a `./mvnw verify -DexcludedGroups=e2e` covers without parsing a build tool, which is the one thing it refuses to do — so the AC lives as the contract on `greenGate` in `config.ts`: the command must cover every tier the branch is judged on except e2e, migration and integration included.
`relay doctor` already prints the resolved command, which is as far as verification can honestly go.

**The gate may not commit, but it may leave the worktree dirty.**
The reviewers' `read-only` rule was wrong here: the gate command runs the repo's build *before* the leg starts, so its artefacts are already uncommitted changes, and the prompt tells the triage to re-run a narrower slice — which makes more.
Failing on that dirt would throw a `RoleError` out of the loop and skip the handover a red gate is owed, so a third rule, `no-commits`, keeps the part that is actually the leg's fault.

**The loop was already the harness's; only the numbering is new.**
`MAX_GATE_FIX_ATTEMPTS` and the gate → fixer loop landed with ticket 07, so this ticket added `greenGate(attempt)`: the gate is the pass's one repeated leg, and each run names its own log (`green-gate-1`, `green-gate-2`, `green-gate-3`) rather than overwriting the last.
The harness owns the counter, as it owns the loop.

**Tested with no docker, model or network.**
A fake sandbox answers the gate command and the triage run: green from exit 0 with no agent run at all even when the output says "BUILD FAILURE", a red exit triaged into a detail, the command/exit code/output tail reaching the prompt, the tail keeping the end of a huge run, the run name per attempt, the gate model, a triage that commits and one that says nothing refused, build artefacts tolerated, plus the harness numbering its three gate runs and the crew wiring the real command.
