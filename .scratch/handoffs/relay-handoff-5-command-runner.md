# Handoff 5 — Grill: one command runner behind three identical seams

**Repo:** `/Users/michael.wurster/work/sandbox/relay` (branch `main`, GitHub `miwurster/relay`)
**Architecture review report:** `/var/folders/qz/4bc1jm096zx27l0rxdkygn040000gp/T/architecture-review-20260727-162134.html` (candidate 5, anchor `#c5`)
**Strength:** Speculative — the weakest of the five. It is on the list because one part of it is real friction; the rest may well deserve rejection.

## Where this came from

A `/kipu-all:improve-codebase-architecture` pass over relay's hot spots. Five candidates surfaced; this is one of five parallel handoffs. No code changed. Nothing decided.

## The candidate, in one paragraph

Three seams share one signature `(args: readonly string[]) => Promise<string>`: `DockerRunner` (`src/docker-host.ts:9`), `GhRunner` (`src/github.ts:46`), `GitRunner` (`src/git.ts:6`). Their real adapters are near-identical `execFileAsync` wrappers differing only in error class and, for `gh`, in not wrapping at all. Separately and more concretely: `src/sandbox.ts:22` keeps its own `execFileAsync` and shells out to git directly in `branchExists` and `worktreeForBranch`, bypassing the `GitRunner` seam — so those two reads are unfakeable, and `pass.ts:77`'s branch-collision refusal can only be tested through a real repo. Proposal: one runner factory parameterised by executable and error class; the three named types stay as the seams callers see; `sandbox.ts` uses the git adapter.

Read `src/docker-host.ts`, `src/github.ts`, `src/git.ts`, `src/sandbox.ts:83-125`.

## What the grilling must settle

- Split the candidate first. The `sandbox.ts` bypass is real friction; the shared factory is duplication-removal with a weak deletion test. Are they one change or two? Recommendation: grill the bypass, treat the factory as optional.
- Deletion test on the factory: delete it — does complexity reappear across the three adapters, or was it three short functions that read fine? Argue against it honestly.
- Do the three named seam types survive? They should: each has a real second adapter (fakes in `tests/doctor.test.ts`, `tests/github.test.ts`, `tests/git.test.ts`), and one shared type would tell a caller less than it knows today.
- `runGh` does not wrap failures in `GitHubError` at the runner level (its callers do, per-operation, `github.ts:181`) while `runDocker` and `runGit` wrap at the runner. Is that difference load-bearing or accidental? It decides whether a shared factory is even possible.
- `maxBuffer: 64 * 1024 * 1024` is repeated three times. Worth a shared constant on its own, independent of everything else?
- If `sandbox.ts` takes the git seam, does `worktreeForBranch`'s porcelain parsing get its own test at last?

## Constraints

- `AGENTS.md`: surgical, simplicity-first, "no abstractions for single-use code", "don't refactor things that aren't broken". This candidate is the one most at risk of violating that — hold it to the standard.
- `npm run verify` must exit zero. Never silence a lint rule.
- Domain vocabulary from `CONTEXT.md`: **pass branch**, **sandbox**, **gate probe**, **held**. Architecture vocabulary from `/codebase-design`: module, interface, seam, adapter, leverage, locality — and specifically "one adapter means a hypothetical seam, two means a real one".
- ADRs in `docs/adr/`: 0007 (one forge, one tracker, no abstraction) is the mood of this repo — relay deliberately does not abstract over tools. A shared command runner is not a tracker abstraction, but the spirit is worth citing.
- No behaviour change; error messages and exit paths must read the same to an operator.
- Rejected with a load-bearing reason → offer an ADR, framed so a future architecture review does not re-suggest collapsing the runners. This is the candidate most likely to earn one.

## Suggested skills

1. `/kipu-all:grilling` — start here, and expect to reject at least half of this.
2. `/kipu-all:codebase-design` — the deletion test and the two-adapters rule.
3. `/kipu-platform:write-an-adr` — likely outcome for the factory half.
4. `/kipu-all:tdd` then `/kipu-all:kipu-commit` — for the `sandbox.ts` bypass, if that half survives.
