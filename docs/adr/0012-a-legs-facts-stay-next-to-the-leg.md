# 0012. A leg's facts stay next to the leg

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

`runRole` takes ten facts: `sandbox`, `config`, `name`, `model`, `outputDir`, `prompt`, `promptArgs`, `tag`, `schema`, `branchRule`.
Each of the seven **role** modules exists in part to restate them, and an architecture review read that as duplication worth collapsing: bind the pass-wide facts once, then declare each role's prompt, tag, schema, branch rule and model key as data in one table.
Two modules — `src/planner.ts` and `src/gate-resolver.ts` — do nothing else, so under that proposal they would be deleted outright.

The question this ADR settles is whether a **role**'s own facts belong in a central table or in the role's own module.

## Decision Drivers

- Five of the seven roles have behaviour a data table cannot hold: the implementer reads a base sha before the run, the reviewer owns a **lens** table and writes a findings file, the green gate runs the gate command before any agent, the fixer names its **leg** and escalates its model, the handover enforces the pull-request rule.
- Every `branchRule` sits beside a comment saying *why* that rule and not another — the resolver's "the worktree came with the clone", the gate's "the build artefacts are already there", the handover's "a commit of its own would reach the human as work no role reviewed". Those comments are the documentation of the branch-rule design.
- The repeated text is the `{ sandbox, config, outputDir }` parameter block, not the per-role facts. Those two are separable, and only the first is duplication.
- relay's own rule: if an abstraction needs escape hatches for most of its members, that is a signal against it.

## Considered Options

- **Option A** — Bind the pass-wide facts once as a named `RoleDeps`, and leave every per-role fact where it is.
- **Option B** — A central leg-spec table: prompt, tag, schema, branch rule and model key as data per role, with the five behavioural roles reading their spec back out of it.
- **Option C** — Change nothing.

## Decision Outcome

Chosen option: **Option A**, because it removes the duplication that exists without relocating the reasoning that does not duplicate.

- `RoleDeps` is declared once in `src/run-role.ts` and `RunRoleOptions` extends it, so the three pass-wide facts are named in one place.
- Each of the seven factories takes `deps: RoleDeps` and spreads it; `createCrew` passes one value seven times.
- Every prompt constant, tag, schema and `branchRule` stays in its role's module, next to the comment explaining it.
- `src/planner.ts` and `src/gate-resolver.ts` survive as thin modules. A role with no behaviour of its own is a fact about that role, not a reason to have no file for it.

Option B was refused rather than deferred: a table serving two roles fully and five partially is a worse home for these facts than seven modules are, and no later change makes that arithmetic better.

### Consequences

- Good: roughly sixty lines of restated parameter blocks go, and the `runRole` call sites shrink to what actually varies per role.
- Good: one role, one file. A reader asking what the fixer does opens `src/fixer.ts` and finds its prompt, its schema, its branch rule and its escalation together.
- Good: `RoleDeps` is a structural type, so no test changed — which is the evidence the change preserves behaviour.
- Bad: `runRole` is still a wide interface, and a reader may still read seven similar-looking factories as boilerplate. Accepted: a **leg** genuinely is that many facts, and the similarity is what makes the crew uniform.
- Bad: a future architecture review will see the same surface shape and may propose the same collapse. This ADR is the answer to it.

### Confirmation

`git grep -l "RoleDeps" src/` lists `run-role.ts`, `crew.ts` and the seven role modules, and no module declares its own `{ sandbox; config; outputDir }` literal.
No central table of prompts, tags or schemas exists; `git grep -n "relay-" src/*.ts` finds each tag in exactly one role module.

## Pros and Cons of the Options

### Option B — a central leg-spec table

- Good, because two role modules would disappear and the crew's shape would be readable in one file.
- Good, because a new role would be a table row rather than a new module.
- Bad, because `branchRule` is a function of the parsed answer for the implementer and the fixer, so the table would hold closures — the same code in a place further from what it describes.
- Bad, because the rationale comments would either move to the table, making it long and heterogeneous, or stay behind in modules that no longer hold the fact they explain.
- Bad, because the five behavioural roles would read their own row back out of a table they are the only reader of, which is indirection bought with no saving.

### Option C — change nothing

- Good, because it is free and the duplication is harmless.
- Bad, because the `{ sandbox, config, outputDir }` block is genuinely one concept written seven times, and naming it costs one interface.

## More Information

- Provenance: an architecture review of relay's role legs, and the grilling of 2026-07-27 that answered it.
- Related: [ADR-0001](0001-the-harness-owns-the-loop.md) — why a **role** is a top-level **cold session**, which is what makes every role the same shape.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
