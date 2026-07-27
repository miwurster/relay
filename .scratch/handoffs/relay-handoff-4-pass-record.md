# Handoff 4 — Grill: one pass record instead of a threaded path string

**Repo:** `/Users/michael.wurster/work/sandbox/relay` (branch `main`, GitHub `miwurster/relay`)
**Architecture review report:** `/var/folders/qz/4bc1jm096zx27l0rxdkygn040000gp/T/architecture-review-20260727-162134.html` (candidate 4, anchor `#c4`)
**Strength:** Worth exploring.

## Where this came from

A `/kipu-all:improve-codebase-architecture` pass over relay's hot spots. Five candidates surfaced; this is one of five parallel handoffs. No code changed. Nothing decided.

## The candidate, in one paragraph

Two shallow modules each wrap `mkdir` + `writeFile`: `src/status-file.ts` (32 lines) and `src/findings-file.ts` (29 lines). The pass's artefact directory is computed inside `findings-file.ts` (`passOutputDir`) while the doctor's is computed inside `gate-probe.ts:29` (`doctorOutputDir`) — two unrelated homes for one concern. A bare `outputDir: string` then threads through `crew.ts` into all seven role modules and down into `run-role.ts:75` and `reviewer.ts:82`. Proposal: one module owns the hand-off directory and both writes — `passRecord(repoRoot, workItem)` / `doctorRecord(repoRoot)` returning `{ writeStatus, writeFindings }` — and legs are handed the record, not a path.

Read `src/status-file.ts`, `src/findings-file.ts`, `src/run-role.ts`, `src/reviewer.ts`, `src/gate-probe.ts`, `src/pass.ts`.

## What the grilling must settle

- Deletion test: does merging the two modules concentrate complexity, or just move it? Be honest — both are tiny.
- Is the record an object with two methods (a seam with a fake adapter for tests), or just two functions plus one place that computes the directory? The second is smaller; the first is what stops seven role tests calling `mkdtemp`.
- Does `writeFindings` belong to the same module as `writeStatus`? They have different lifetimes and audiences: a status file per leg, a findings file per lens. `findings-file.ts`'s own comment argues for a file per lens — that reason survives either way.
- If the record becomes a seam, does it get injected all the way down to `runRole`, or does the leg runner (see handoff 1) hold it? **This candidate composes with handoff 1** — decide whether to grill them together.
- Does anything else want to land in the pass's output dir later (the *handover* report is currently only printed to stdout, `handover.ts:77`)? Only count it if it is real, not speculative.

## Constraints

- `AGENTS.md`: surgical, simplicity-first, no abstraction for single-use code. `npm run verify` must exit zero.
- Domain vocabulary from `CONTEXT.md`: **pass**, **leg**, **role**, **lens**, **finding**, **handover**, **doctor**, **gate probe**. The artefacts are the hand-off a human reads after the pass — that framing is already in the two modules' doc comments. Architecture vocabulary from `/codebase-design`: module, interface, depth, seam, adapter, leverage, locality.
- ADRs in `docs/adr/`: 0003 (a crashed pass leaves the work for a human) is why these files exist on the host at all — the sandbox's worktree is disposed of. Do not re-litigate it.
- No behaviour change: same files, same names, same directory layout under `.relay/`.
- New term coined (e.g. "pass record") → add to `CONTEXT.md`. Rejected with a load-bearing reason → offer an ADR.

## Suggested skills

1. `/kipu-all:grilling` — start here. Lead with the deletion test; this one deserves a real chance to be talked out of.
2. `/kipu-all:codebase-design` — depth and the deletion test.
3. `/kipu-all:domain-modeling` — inline `CONTEXT.md` upkeep.
4. `/kipu-platform:write-an-adr` — only on a load-bearing rejection.
5. `/kipu-all:tdd` then `/kipu-all:kipu-commit` — after the shape is settled.
