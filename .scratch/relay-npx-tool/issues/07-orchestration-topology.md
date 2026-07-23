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

## Operator input (captured in ticket 04 grilling, 2026-07-23)

The operator sketched this flow while resolving ticket 04. Pre-seeded input for this ticket — **not yet a locked decision**, to be grilled here:

- The **planner agent** gets only the picked Jira work-item key; it retrieves/fetches the actual things to do **from Jira itself** (via MCP), then decides which task to do next (or works the item).
- Planner sets the ticket to **In Progress**, then exits handing the first implementer the information it needs (the implementer reads the Jira story/ticket, etc.).
- The **implementer** runs the `kipu-implement` method:
  - implements in a **Sonnet** subagent, commits via `kipu-commit` in a **Haiku** subagent;
  - launches two review subagents in parallel — one **spec review**, one **code review** (`kipu-code-review`), both **Opus**;
  - a **Sonnet** implementation subagent addresses the suggested changes from both reviews;
  - final commit via `kipu-commit` in a **Haiku** subagent;
  - hands back to the planner agent, commenting the task if needed.
- The **planner agent** moves the task to **In Review** and selects the next task.

Note: this frames the planner as a persistent in-sandbox loop-driver that owns Jira transitions, which reshapes ticket 03's host-side-planner / `Output.object` / per-ticket-loop framing — reconcile here.
