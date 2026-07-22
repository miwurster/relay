# Orchestration topology — the subagent graph

Type: grilling
Status: open
Blocked by: 01

## Question

What is the exact subagent graph that replaces kipu-afk-as-umbrella, built on the author's Sandcastle patterns?

The hard constraint: the harness (TS) is the orchestrator; each role is a first-class `sandcastle.run()` (a top-level claude-code process that can itself spawn), so the review skills run properly instead of degrading to inline rubrics. Model the graph on the author's own workflows (`course-video-manager` `.sandcastle/agent-workflows/`, `run-with-retry`, `review/`, `update-branch/`), not the qc-catalog spike.

Decide:

- The roles and order: planner → per-ticket [implementer (TDD) → fast code review ∥ fast spec review → fixer] → whole-branch [in-depth code review ∥ spec review → fixer] → quality gate (+ fixer) → handover.
- Which run in parallel; which share a sandbox/branch; per-phase handoff artifacts (files, not pasted context).
- Model per role (planner/implementer/reviewer/fixer/committer) and fix-loop caps + escalation.
- How review findings feed the fixer (merge/dedup), mirroring kipu-afk Phase 1 / Phase 2 semantics but with real skill-driven subagents.

Depends on ticket 01 (how skills drive each headless subagent).
