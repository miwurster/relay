# 08 — Planner role

**What to build:** Replace the planner stub with the real one-shot planner. It is config-driven off `docs/agents/issue-tracker.md` (tracker access, repo label, relation model, issue-type mapping). It ensures the item is In Progress (idempotent — no-op if already there, tolerant of a re-run after crash), then emits an ephemeral `Output.object` plan of ticket refs: a work item with related tickets in dependency order, one with none as a singleton. It verifies-and-orders pre-existing tickets only — never authors slices or decomposes on the fly. An under-specified ticket bails to a human rather than being fabricated.

**Blocked by:** 07, 02

**Status:** resolved

- [x] Planner runs one-shot, config-driven off `issue-tracker.md`
- [x] Ensures In Progress idempotently (via the transitions list); safe to re-run after crash
- [x] Emits `Output.object` plan: related tickets in dependency order, else singleton
- [x] Verifies-and-orders only; never authors or decomposes slices
- [x] Under-specified ticket ⇒ bail-to-human, never fabricate

## Answer

`src/planner.ts` (the role), `src/resources/planner.md` (its prompt), `src/role-agent.ts` (how any role's agent is launched), `src/tagged-output.ts` (how any role's answer is read), `src/crew.ts` (`createCrew` — the real crew, planner-only so far).

**Config-driven means the prompt reads the doc, not that relay parses it.**
The planner is sent to `docs/agents/issue-tracker.md` in the worktree for all four things the ticket lists — tracker access and ids, repo label, relation model, issue-type mapping — and told to assume none of them.
The host parses only the two setup constants selection already needed; the cloud id ticket 06 deferred here is a tracker-doc lookup the planner does itself, so no config surface grew.

**The transition is the planner's one tracker write.**
The prompt has it read the status and the item's own transitions list, no-op when already In Progress, and never hardcode a transition id.
Finding the item already In Progress after a crashed run is named as normal, not an error.

**`Output.object` is not available on a long-lived sandbox, so relay extracts the block itself.**
`SandboxRunOptions` (what `sandbox.run` takes) has no `output`; only sandcastle's top-level `run()` does, and that opens its own sandbox per call — which is exactly what the crew seam exists to avoid.
`readTaggedOutput` does what `Output.object` would: last `<relay-plan>` block, fence-unwrapped, JSON-parsed, zod-validated, `RoleError` otherwise.
`Output.object`'s `maxRetries` re-prompt is dropped rather than reimplemented: a planner that cannot emit its own answer is a crash (exit 2), not something to coax.

**Order is the array, and the array is the plan.**
`TicketRef` is ticket 07's and stays `{ key, summary }`: the harness implements the plan in order, so position *is* the blocking order and a separate order field would be a second source of truth.
An empty ticket list is rejected by the schema — an item with no related tickets is a singleton of itself, which is what the prompt asks for.

**Roles get skills and Jira as session flags.**
`roleAgent` wraps sandcastle's `claudeCode` provider and inserts `--plugin-dir` per mounted plugin plus `--mcp-config` into the built command, since the provider takes no flags of its own.
An unrecognised command throws rather than silently running a role with no skills and no tracker.
Every later role reuses this and `readTaggedOutput`.

**Tested with no docker, model or network.**
The seam is `sandbox.run`: a fake sandbox returns stdout, and the tests assert the model, one-shot, the prompt args, both bail and plan mappings, and the flags the command carries.
