# Orchestration topology — the subagent graph

Type: grilling
Status: resolved
Blocked by: 01

> Revised by ticket 13: spec-review roles fetch brief/spec from the tracker (not a harness-materialized file), so each spec-review `sandbox.run` needs Atlassian MCP wired.

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

## Answer

Resolved by grilling (2026-07-24). The operator sketch's persistent-planner framing is **rejected**; ticket 03's harness-driven model stands. Full graph below.

### Reconciliation: the harness owns the loop

The map's hard constraint — *orchestration lives in the harness; each role is a first-class `sandcastle.run()` so spawning skills work* — settles the tension. A persistent in-sandbox planner would make the implementers/reviewers **its** Task-tool subagents, which is exactly kipu-afk's umbrella compromise (skills degrade to inline rubrics). So:

- The **TS harness** owns the loop, modelled on the author's `course-video-manager/.sandcastle/main.ts` (Planner emits a plan → harness iterates → dispatches each role as a top-level run).
- The **planner** is a **one-shot** run: reads Jira + repo tickets via MCP, sets the item **In Progress**, emits an ordered ticket list (ticket 03's ephemeral `Output.object`), exits. It does **not** drive the loop.
- The operator sketch's intent survives — Jira transitions still happen, order still comes from a planner — but as harness-orchestrated steps, not one long-lived agent.

### Sandbox / session / branch model

- **One Docker sandbox** for the whole pass (`createSandbox` once, disposed at end). Every role runs inside it.
- **One branch + one worktree**; every ticket's commits accumulate → one MR. No per-ticket branches (relay is single-item; the author's per-branch parallelism is the multi-issue case).
- **Each role is a separate `sandbox.run` = fresh Claude Code process = its own cold session.** Roles share **only files + git**, never inherited conversation context. (The sole session *resume* is within a role — the `run-with-extraction` produce→extract pass.)
- **Tickets run sequentially** (dependency-ordered per ticket 03). Within a ticket, the two review lenses run **concurrently** — read-only on the same committed worktree, safe.

### The graph

```
HARNESS (TS, owns loop)
│
├─ Planner (opus)            reads Jira+repo tickets via MCP; sets In Progress;
│                            emits ordered ticket list (Output.object) → plan file;
│                            under-spec ⇒ early bail (ticket 05, no MR, exit 1)
│
├─ for each ticket, sequentially:            ── per-ticket phase ──
│    ├─ Implementer (sonnet)     custom prompt (below); /tdd at seams; self-commits
│    │                           via /kipu-commit; mounts tdd + kipu-commit
│    ├─ Fast code review ∥ spec review (opus)   read-only → findings file (run-with-extraction)
│    └─ Fixer (sonnet)           if findings: merge → apply → self-commit /kipu-commit
│                                [one-shot, no re-review]
│
├─ In-depth code review ∥ spec review (fable)   ── whole-branch phase, ONCE ──
│                            read-only over full branch → findings file
├─ Fixer (sonnet)           if findings: apply → self-commit  [one-shot]
│
├─ Quality gate (sonnet)    run gate command (ticket 06); fail → triage → Fixer
│                           (self-commits) → re-run; cap 2; still red ⇒ mid-block
│
└─ Handover (sonnet)        kipu-mr push + open MR; set In Review + resolution
                            comment + human report; exit 0 / block 1 / error 2 (ticket 05)
```

### Roles, order, models

| Role | Model | Notes |
|------|-------|-------|
| Planner | opus | one-shot; sets In Progress; emits ordered plan |
| Implementer | sonnet | custom prompt; /tdd; self-commits via /kipu-commit; uncommitted → its own commit |
| Fast code review | opus | read-only, parallel with spec |
| Fast spec review | opus | read-only, parallel with code |
| In-depth code review | fable | whole-branch, once, parallel with spec |
| In-depth spec review | fable | whole-branch, once, parallel with code |
| Fixer | sonnet | applies merged findings; self-commits via /kipu-commit |
| Quality gate | sonnet | runs gate + triages failure for the fixer |
| Handover | sonnet | kipu-mr + Jira In Review + report |

**No separate commit role.** Commit rides inside the implementer/fixer session (their model) via the mounted `kipu-commit` skill.

### Implementer prompt (custom, exact)

Not a call to the `implement` skill — a custom prompt with the `implement` skill's wording minus its review line, plus an explicit commit line:

```
Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the current branch using /kipu-commit.
```

Code review is **externalized** to the separate review roles, so the `implement` skill's `Once done, use /code-review` line is dropped. The **fixer** uses the same trailing commit line.

### Fix loops, findings, escalation

- **Findings → fixer**: each review emits structured findings via `run-with-extraction` (produce → extract, preserves commits). The **harness merges** by concatenating the two lenses' arrays and tagging each finding `code`/`spec` into one findings file — **no semantic dedup in the harness**. The **fixer** reconciles/dedups (it has the code + both lenses).
- **Loops**: reviews are **one-shot** (subjective → a re-review loop never terminates). Only the **quality gate loops**: fail → fixer → re-run, **cap 2** (initial gate + up to 2 fix attempts). The whole-branch in-depth review is the net for what fast fixes missed; the gate is the objective backstop.
- **Escalation** (feeds ticket 05 endpoints): planner under-spec ⇒ early bail (no MR, exit 1); any exhausted cap / unresolvable block ⇒ mid-block Draft MR + `agent-blocked` (exit 1).
- **Handoff / escalation payload**: every role writes a status file to `OUTPUT_DIR` on exit (author's `verdict.txt` / `failure_reason.txt` / `summary.md` pattern) + the findings files; the handover step assembles them into the human report. Progress = the commits on the branch.

### Deltas to already-resolved tickets

- **Ticket 01** (headless skill delivery): mount list gains **`tdd`**; `kipu-commit` stays; the `implement` skill is **not** mounted (implementer uses the custom prompt above). Its "never slash" rule was already relaxed by ticket 11 — `/tdd` and `/kipu-commit` are invoked by slash.
- **Ticket 06** (config + models): the model map's **`commit` row is removed** (commit folds into implementer/fixer sonnet); **`quality-gate` haiku → sonnet** (the gate now triages failures for the fixer, which is reasoning work).
- **Map Notes**: relay **sunsets `kipu-afk` and `kipu-implement`** when live — relay is their replacement, not a consumer. `kipu-implement` is dropped from the "skills the build will use" list; the leaner `implement`-derived prompt + `tdd` take its place.
