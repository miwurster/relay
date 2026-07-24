# 08 — Planner role

**What to build:** Replace the planner stub with the real one-shot planner. It is config-driven off `docs/agents/issue-tracker.md` (tracker access, repo label, relation model, issue-type mapping). It ensures the item is In Progress (idempotent — no-op if already there, tolerant of a re-run after crash), then emits an ephemeral `Output.object` plan of ticket refs: a work item with related tickets in dependency order, one with none as a singleton. It verifies-and-orders pre-existing tickets only — never authors slices or decomposes on the fly. An under-specified ticket bails to a human rather than being fabricated.

**Blocked by:** 07, 02

**Status:** ready-for-agent

- [ ] Planner runs one-shot, config-driven off `issue-tracker.md`
- [ ] Ensures In Progress idempotently (via the transitions list); safe to re-run after crash
- [ ] Emits `Output.object` plan: related tickets in dependency order, else singleton
- [ ] Verifies-and-orders only; never authors or decomposes slices
- [ ] Under-specified ticket ⇒ bail-to-human, never fabricate
