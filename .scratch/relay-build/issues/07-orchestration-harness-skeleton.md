# 07 — Orchestration harness skeleton (Seam 2)

**What to build:** The harness loop that owns the pass, built with **stubbed roles** so the whole topology and every exit path is exercisable without real agents. The harness runs: planner (one-shot) → per-ticket [implementer → fast code review ∥ fast spec review → fixer] → whole-branch [in-depth code review ∥ spec review → fixer] once → quality-gate → fixer (loop, cap 2) → handover. Each role is a separate `sandbox.run` (own cold session), sharing only files + git. The harness array-merges concurrent findings; the fixer stub dedups. Failure/recovery is proven here: crash → exit 2 + item left In Progress + best-effort Jira comment + sandbox always disposed; branch collision → refuse, exit 2 (never delete foreign commits); needs-input never pauses (collapses to mid-block).

**Blocked by:** 05, 06

**Status:** resolved

- [x] Full topology runs end to end with stubbed roles: planner → per-ticket loop → whole-branch review → gate → handover
- [x] Two review lenses run concurrently, read-only; findings array-merged, deduped by fixer
- [x] Quality-gate → fixer loop capped at 2
- [x] Exit-code mapping 0 / 1 / 2 asserted at the seam with a fake Jira client
- [x] Crash → exit 2, item In Progress, sandbox disposed
- [x] Branch collision → refuse, exit 2, no commits deleted

## Answer

`src/crew.ts` (the role seam + the stub crew), `src/harness.ts` (the topology), `src/pass.ts` (sandbox lifecycle, collision refusal, crash reporting).

**The crew is the seam, not the sandbox.**
`Crew` is six methods — `plan`, `implement`, `review`, `fix`, `qualityGate`, `handover` — and the harness passes nothing between them but small values (`TicketRef`, `Finding`, `GateResult`, `Outcome`), because the roles share only files and git anyway.
Each of tickets 08–13 replaces one method of `createStubCrew`; nothing else about the topology moves.
The stubs log rather than call `sandbox.run`, so the whole topology is exercisable with no docker, no model and no network — `createCrew` takes the open sandbox, which is where the real roles' `sandbox.run` calls will hang.

**Concurrency is the harness's, dedup is the fixer's.**
`reviewAndFix` runs a scope's lenses with `Promise.all` and concatenates the results blindly.
Only a role that reads the code can tell two phrasings of one problem apart, so the stub fixer dedups and the real one will too.

**Only the objective gate loops.**
`driveGate` re-runs the gate after each fix, capped at `MAX_GATE_FIX_ATTEMPTS = 2`; still red after that is a `mid-block` outcome.
The subjective review lenses run exactly once each.

**needs-input never pauses.**
An implementer that wants an answer returns `{ kind: "needs-input" }`, which stops the ticket loop and collapses into the mid-block handover.
Every exit path — early bail, mid-block, success — leaves through the same `handover` call.

**Exit codes.**
`exitCodeFor` maps `success` to 0 and both blocked outcomes to 1.
Errors stay on the existing convention: `runPassOnItem` rethrows and `runCli` maps to 2, so a crash and a branch collision are both exit 2 without a second mapping table.

**Failure paths are the pass's, not the harness's.**
`runPassOnItem` refuses before opening a sandbox when `branchExists` (a plain `git show-ref`) says the branch is already there — relay never reuses, resets or deletes a branch, since it may carry someone else's commits.
A crash gets a best-effort Jira comment (new `JiraClient.addComment`) and is rethrown, including a crash while the sandbox is still opening.
The sandbox is disposed of in a `finally` either way.
Relay never transitions the item back, so a crashed item stays In Progress and a re-run finds it there.

**Tested without docker or a network.**
The harness is tested against a recording crew (order, concurrency, merge, gate cap, both bail paths).
The pass is tested against a fake Jira client, a fake sandbox and a real temp git repo for the collision case, with exits 0, 1 and 2 all asserted at that seam.
