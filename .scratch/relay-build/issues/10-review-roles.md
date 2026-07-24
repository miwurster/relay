# 10 — Review roles (four lenses)

**What to build:** Replace the review stubs with the real roles: per-ticket fast code review ∥ fast spec review (opus), and once-per-branch in-depth code review ∥ spec review (fable). All run concurrently, read-only. The spec-review roles fetch their intent (ticket brief / spec + ticket list) from the tracker per `issue-tracker.md` by key — the tracker is the single source of truth, no planner-written file handoff. kipu-code-review needs no fetch. Findings are written to findings files (via the run-with-extraction pattern) for the harness to merge.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Per-ticket fast code ∥ spec review and whole-branch in-depth code ∥ spec review, concurrent read-only
- [ ] Spec-review fetches brief/spec from the tracker by key; code-review needs no fetch
- [ ] Each spec-review `sandbox.run` has the Atlassian MCP wired
- [ ] Findings extracted to files in the output dir for harness merge
- [ ] Per-role model map applied (fast: opus, in-depth: fable)
