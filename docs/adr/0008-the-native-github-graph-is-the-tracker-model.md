# 0008. The native GitHub graph is the tracker model, and labels carry lifecycle

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

[ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) settles that relay hardcodes GitHub.
This one settles *what* it hardcodes, because Jira gave relay four things GitHub does not hand over in the same shape:

- a **status category**, so `done` was one field read, and named transitions to `In Progress` and `In Review`;
- an **issue type**, which gated what relay would run over and told a **work item** from a **ticket**;
- a **priority**, which ordered the **frontier**;
- a **`Blocks` link type**, which gave the **eligibility check** its **open blockers** and the planner its ticket order.

GitHub issues have `open`/`closed`, labels, and — since 2025 — native **sub-issues** and **issue dependencies**.
Each of the four could be modelled on the native graph, on a GitHub Project board, or on conventions relay invents in issue bodies.

## Decision Drivers

- Whatever relay reads, a human must see in GitHub's own UI without opening relay's docs.
- Parsing prose in an issue body makes the tracker's state depend on formatting nobody enforces.
- The **frontier** scan runs on every **pass**, so its cost in API calls matters.
- Ids that vary per repo (project ids, field ids, transition ids) are exactly what the current prompts avoid hardcoding.
- Where GitHub's semantics are undocumented, relay must not guess.

## Considered Options

- **Option A** — Native graph plus labels: sub-issues and issue dependencies for structure, labels for lifecycle, `closed` for done, creation order for the frontier.
- **Option B** — GitHub Projects v2: a board with a status field, a priority field, and human-dragged rank.
- **Option C** — Body conventions: a `Blocked by: #n` line and a task list of child issues, parsed by relay.

## Decision Outcome

Chosen option: **Option A**.
The switch is one to GitHub's grain, not a Jira emulation on GitHub's API.

**Structure is the native graph.**
A **work item**'s **tickets** are its sub-issues; blocking is native issue dependencies.
`gh issue list --json blockedBy,subIssues` resolves the real edges for a whole page in **one** GraphQL call, so the frontier scan stays a single request and the body-convention fallbacks relay had provisionally reserved were dropped before they were written.

**Structure replaces the type gate.**
A parent with sub-issues is a work item, its leaves are tickets, and a childless issue is its own single ticket — which is already what the planner does.
So `RUNNABLE_TYPES` is deleted rather than ported: the gate existed because one Jira project held Epics, Spikes and Documentation in one query, and on GitHub an Epic stops being a hazard and becomes the ordinary multi-ticket case.
`ready-for-agent` — a deliberate human act — carries the rest of that weight.

**Lifecycle is labels.**
The planner applies `agent-in-progress`; the handover swaps it for `agent-in-review` on success or `agent-blocked` on a block.
Jira's "ensure, do not set" survives as idempotent label edits, with no transitions list to read and no per-project ids to hardcode.
`docs/agents/triage-labels.md` already establishes labels as this org's state vocabulary.

**The frontier is longest-waiting first.**
GitHub has no priority field, and inventing `priority:*` labels would mint a taxonomy the org does not use.
Humans steer by *when* they apply `ready-for-agent`; the frontier is a prefilter, and a human who wants a specific item names it and faces the same gates.

Two obligations fall to relay, because GitHub does not cover them:

- **Open-blocker filtering is relay's own.** GraphQL `blockedBy.totalCount` counts closed blockers too, so eligibility filters `blockedBy[].state == "OPEN"` itself.
- **relay never writes a closing keyword against a parent.** GitHub's closing-keywords docs never mention hierarchies, and a probe showed it neither refuses nor warns: closing a parent left both children open and marked the parent `completed` with `0 of 2`. So the pull request carries `Closes #<child>` per **ticket** it committed, and a human closes the parent — visibly, because GitHub shows the `2 of 2` count.

One hazard is worth recording because it is silent: `POST …/issues/{n}/dependencies/blocked_by` takes a numeric **database id**, and passing an issue *number* returns `201` while linking a stranger's issue in an unrelated repository.
Reproduced during the research.
relay writes dependency edges only through `gh issue edit --add-blocked-by <number>`.

### Consequences

- Good: everything relay reads or writes is visible in GitHub's own UI — the sub-issue tree, the dependency edges, the labels.
- Good: the frontier stays one API call, so eligibility is cheap no matter how long the backlog is.
- Good: no per-repo ids enter the **tracker doc** — no project id, no field id, no option id, no transition id.
- Good: three concepts leave the codebase (`RUNNABLE_TYPES`, `issueType`, priority ordering) instead of being re-expressed.
- Bad: relay carries GitHub's undocumented edges as its own obligations — the open-blocker filter and the parent-closing discipline are relay's to keep correct, and GitHub will not fail loudly if either regresses.
- Bad: a **work item** stays open after its pull request merges, so someone must close the parent. Deliberate, and cheaper than the alternative of relay closing a parent whose children are open.
- Bad: priority is genuinely lost. Labelling order is a coarser lever than a ranked backlog.
- Bad: `blockedBy` nodes report `"OPEN"`/`"CLOSED"` while REST reports lowercase, and the `repository` field `gh` requests never appears in output — so a cross-repo blocker must be spotted from its `url`. Both are shape details relay now depends on.

### Confirmation

`tests/work-item.test.ts` covers the open-blocker filter against a closed blocker, the `agent-in-progress` hold, and a work item whose only blocker lives in another repository.
`src/github.ts` contains no `gh api` call against a `dependencies` endpoint.
Sub-issues are sorted by number, since their order is undocumented and empirically insertion order.

## Pros and Cons of the Options

### Option B — GitHub Projects v2

- Good, because a status field and a rank field are the closest match to what Jira gave relay, priority included.
- Good, because a board is where humans already look at work.
- Bad, because it needs GraphQL and puts project, field and option ids in the **tracker doc** — the exact id-hardcoding the prompts were written to avoid.
- Bad, because it makes every target repo own a Project before relay works at all.

### Option C — body conventions

- Good, because it works on any plan, with no dependence on GitHub features.
- Bad, because `gh issue list --json blockedBy,subIssues` already answers both questions in one call, so the convention buys nothing.
- Bad, because it parses prose nothing enforces, and a task list's checkbox state becomes a second, disagreeing source of "done".

## More Information

- Provenance: `.scratch/github-switch/decisions.md`, grilling of 2026-07-26.
- Every API fact above: `.scratch/github-switch/research/01-github-api-shape.md`, verified against gh 2.96.0.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md), [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md) — the `agent-in-progress` hold is what a crashed pass leaves behind.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
