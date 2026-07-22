# Work-item selection, type guard, and planner responsibility

Type: grilling
Status: resolved
Blocked by: —

## Question

How does the tool pick and shape the work item, and what does the planner produce?

Decide:

- The JQL for "next `ready-for-agent` Story / Bug / Vulnerability for this repo," and the param-validation rule (given a Task → exit `error`; auto-pick never selects a Task). Note this **inverts** the spike's shape guard (which refuses issues *with* children).
- Repo scoping — reuse the spike's `repo:<remote-last-segment>` label convention?
- Does the **planner** decompose the work item into slices/tickets on the fly (grep the item + gather repo context, then emit a plan), or does it consume **pre-existing child tickets** (the kipu-afk model, `/to-issues` output)? What happens when a Bug/Vulnerability has no children?
- Where the plan lives / how it hands to the per-ticket implementer loop.

## Answer

The planner is **config-driven** off the repo's `docs/agents/issue-tracker.md` and **verifies-and-orders** pre-existing tickets — it never authors slices.

### Config-driven, not hardcoded

The planner loads `docs/agents/issue-tracker.md` first and reads, from that file (not from hardcoded Jira assumptions):

1. **Tracker access + scoping** — tracker type (Jira-via-MCP / local-markdown / git host), **repo label** (`repo:qc-catalog`), project key (`PSD`), cloud id, and the frontier query.
2. **Relation model** — how "blocks / is blocked by" is expressed here (native "is blocked by" links in qc-catalog; a `Blocked by:` line or directory files elsewhere) and the spec/ticket → issue-type mapping.

Repo scoping is **sourced from the config file, not derived from the git remote** (the spike derived `repo:<remote-last-segment>`; that derivation is dropped, or kept only as a fallback if the file omits the label). The file can differ per repo, so the *mechanism* is config-driven even though the pilot binds to qc-catalog's Jira/blocking-edge model.

Note: the exact **shape of the config surface** the planner consumes is co-owned with ticket 06 (per-repo configuration surface) — this ticket fixes *that the planner reads it and adapts*; 06 fixes *what it must provide*.

### Selection

- **Auto-pick (no param)** — the file's frontier query narrowed to the auto-pick types:
  ```
  project = PSD AND labels = "repo:qc-catalog"
    AND labels = "ready-for-agent"
    AND statusCategory != Done
    AND labels not in ("agent-running")
    AND issuetype in (Story, Bug, Vulnerability)
  ```
  Then drop any candidate with an **open blocker** (per the file's frontier rule) and take the **first**, ordered **priority DESC, then created ASC**. One pass = one item.
- **Type guard keys on type, not child-count** — `issuetype in (Story, Bug, Vulnerability)` structurally excludes a `Task` from auto-pick. This **inverts the spike**, which refused issues *with children*; child-count no longer gates eligibility (see planner below).
- **Explicit key (param)** — a *targeted* pick, subject to the **same gates** as auto-pick, no override:
  - `ready-for-agent` **required** (no bypass), correct **type** (Task/other ⇒ break), correct **repo** scope, and **not `agent-running`**.
  - If the item declares an **open blocker ⇒ break**. No proceed-anyway.
  - Any gate failure **breaks the pass** with a reason (not a silent skip). Only difference from auto-pick: it targets *that* key instead of the first frontier item.

### Planner responsibility — verify and order, never author

A `ready-for-agent` item is self-sufficient by construction (triage / `/to-tickets` already made it implementable). The planner therefore resolves the entry item into an **ordered plan of already-actionable tickets**:

- **Item has related actionable tickets** (under the repo's declared relation model — in qc-catalog, `Relates`/blocking-linked `Task`s the item is the spec for) → the plan **is** those tickets, walked in the file's **frontier / dependency order**.
- **Item has none** (raw Bug/Vulnerability, un-sliced Story) → **singleton plan**: the item itself is the one ticket; the per-ticket loop runs once. (This answers "what if a Bug/Vulnerability has no children.")

Plurality always comes from **pre-existing** tickets, never from planner decomposition — **on-the-fly slicing is rejected**.

Two guardrails:
1. **Ephemeral plan, no Jira writes.** The plan is an ordered, `Output.object`/zod-validated list of ticket refs (key + brief + blocking order) held in the run process / worktree — never written back as new Jira tickets. Optionally serialized to the run log / handover artifact for observability.
2. **Readiness gate, not slicing.** The planner checks each ticket conveys enough to implement. Too thin ⇒ it does **not** fabricate; it **bails to the human** (needs-input path). The bail's exact shape is owned by ticket 05 (handover) and the resume/needs-input fog.

### Handoff seam

The planner hands the ordered, validated plan object to the **per-ticket implementer loop**; each element becomes one implementer subagent invocation under TDD. The loop's internal shape — subagent graph, context-reset between tickets, review/fix/commit roles around each element — is **ticket 07's** (orchestration topology) call, not this one. Ticket 03 stops at: *planner produces this ordered plan object and hands it to the loop.*
