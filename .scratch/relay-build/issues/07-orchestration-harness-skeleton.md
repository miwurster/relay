# 07 — Orchestration harness skeleton (Seam 2)

**What to build:** The harness loop that owns the pass, built with **stubbed roles** so the whole topology and every exit path is exercisable without real agents. The harness runs: planner (one-shot) → per-ticket [implementer → fast code review ∥ fast spec review → fixer] → whole-branch [in-depth code review ∥ spec review → fixer] once → quality-gate → fixer (loop, cap 2) → handover. Each role is a separate `sandbox.run` (own cold session), sharing only files + git. The harness array-merges concurrent findings; the fixer stub dedups. Failure/recovery is proven here: crash → exit 2 + item left In Progress + best-effort Jira comment + sandbox always disposed; branch collision → refuse, exit 2 (never delete foreign commits); needs-input never pauses (collapses to mid-block).

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] Full topology runs end to end with stubbed roles: planner → per-ticket loop → whole-branch review → gate → handover
- [ ] Two review lenses run concurrently, read-only; findings array-merged, deduped by fixer
- [ ] Quality-gate → fixer loop capped at 2
- [ ] Exit-code mapping 0 / 1 / 2 asserted at the seam with a fake Jira client
- [ ] Crash → exit 2, item In Progress, sandbox disposed
- [ ] Branch collision → refuse, exit 2, no commits deleted
