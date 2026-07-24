# Review-role spec/brief source

Type: grilling
Status: resolved
Blocked by: 03, 07

## Question

How does each spec-review role obtain the ticket brief (ticket scope) / spec + ticket list (spec scope) it measures the diff against, given ticket 07's model where each role is a cold `sandbox.run` sharing only files + git — never inherited conversation?

The `kipu-spec-review` skill already carries two input paths (its Scope section): a `kipu-afk` file convention (`<repo>/.kipu/implement/<KEY>/ticket-<KEY>-brief.md`, `<repo>/.kipu/afk/<KEY>/spec.md`) **or** "standalone, from the tracker per `docs/agents/issue-tracker.md`". relay sunsets `kipu-afk`, so the `.kipu/` path dies — which surviving path feeds the review roles:

- **Option A — file handoff.** The harness materializes the planner's plan (key + brief) into per-ticket brief / whole-branch spec files in the worktree/`OUTPUT_DIR`; the reviewer reads the file. Keeps reviewers MCP-free.
- **Option B — tracker fetch.** The reviewer fetches brief/spec from the tracker per `issue-tracker.md` by key — the skill's existing "standalone" path. Needs tracker (Jira MCP) access in the review-role sandbox.

## Answer

Resolved by operator decision (2026-07-24): **Option B — tracker fetch per `docs/agents/issue-tracker.md`.**

Each **spec-review** role resolves its intent live from the tracker by work-item key, using the skill's existing "standalone, from the tracker" path — not a planner-written file handoff. The `kipu-afk` `.kipu/implement/<KEY>/…` and `.kipu/afk/<KEY>/spec.md` file conventions are dropped with `kipu-afk`.

This keeps the tracker the **single source of truth** for intent: the reviewer measures the diff against what the tracker actually says now, with no risk of a stale harness-materialized copy drifting from the ticket. It also reuses a path the skill already supports, so the rewrite is a deletion (drop the `.kipu/` branch), not a new mechanism.

**Scope:** only the **spec-review** lens fetches from the tracker (it needs the brief/spec). `kipu-code-review` is the standards/maintainability lens — it measures the diff against repo standards, not the ticket brief, so it needs no tracker fetch.

**Skill rewrite deferred** — done later, not in this map. When it happens: `kipu-spec-review`'s Scope section drops the two `kipu-afk` `.kipu/` paths and keeps only the tracker path (ticket scope from the tracker by key; spec scope = the item + its ticket list per `issue-tracker.md`).

### Deltas to already-resolved tickets

- **Ticket 04** (credential + secrets flow): reverses "the in-sandbox **planner** does all Jira read". Jira **read** now extends to the spec-review roles too. Same single service-account identity — the SA bearer already enters the sandbox (MCP) — so **no new secret**. Jira **writes / transitions** stay planner + handover only; reviewers are read-only against the tracker as well as the worktree.
- **Ticket 07** (orchestration topology): review-role inputs are **not** a harness-materialized brief file. Each **spec-review** `sandbox.run` needs Atlassian MCP wired (bearer + pinned cloudId) so it can fetch by key. Output handoff (per-role status + findings files in `OUTPUT_DIR`) is unchanged; only the *input* source is the tracker.
- **Ticket 01** (headless skill delivery): the spec-review role's sandbox run must have the Atlassian MCP configured, same as the planner — not just the mounted skills.
