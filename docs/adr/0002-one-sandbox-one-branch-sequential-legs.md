# 0002. One sandbox, one branch, and strictly sequential legs

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

A **pass** runs many **legs** over one **work item**.
Each leg could have its own container, its own branch, or run alongside its siblings.

Two **lenses** read the same **review scope** and are strictly read-only, so they look like free parallelism.
The two whole-branch lenses look the same.
The temptation to run them together is real, and the original topology decision did plan for it.

## Decision Drivers

- relay is single-item by design: one **work item**, one reviewable branch, one pull request.
- A **leg** hands its work on by committing, so every leg must see the previous leg's commits.
- Wall-clock time matters, but a misattributed commit does not survive review at all.

## Considered Options

- **Option A** — One **sandbox**, one **pass branch**, one worktree; every **leg** sequential.
- **Option B** — One sandbox and branch, but the two **lenses** of a **review scope** run concurrently.
- **Option C** — A sandbox or branch per **ticket**, merged at the end.

## Decision Outcome

Chosen option: **Option A**, because the **legs** share one git worktree, and two agents committing into one worktree race on the same refs.

This revises the original topology plan, which had the lenses of a scope running concurrently on the grounds that they are read-only.
That reasoning did not survive contact with the implementation: each leg takes a HEAD baseline before it starts and detaches, merges and deletes its own branch afterwards, so two legs at once misattribute each other's commits — read-only or not.

### Consequences

- Good: every **leg** reads a branch that is exactly what the previous leg left, with no race.
- Good: one branch means one pull request, which is what a human is being handed.
- Good: **ticket** ordering stays the planner's, and dependencies between tickets simply work.
- Bad: a **pass** is as slow as the sum of its legs; the two-lens parallelism is left on the table.
- Bad: recovering that parallelism later means giving each lens its own worktree, which is a real change, not a flag.

### Confirmation

`src/harness.ts` runs lenses in a plain `for` loop, and the reason is stated at the loop.
Any future change to concurrency has to delete that comment first.

## Pros and Cons of the Options

### Option B — concurrent lenses

- Good, because the two lenses of a scope are genuinely independent reads.
- Good, because it roughly halves the review time of every **ticket**.
- Bad, because both legs manipulate refs in the one shared worktree and misattribute each other's commits.
- Bad, because the failure is intermittent and shows up as a wrong diff, which is the worst kind of bug to hand a human.

### Option C — sandbox or branch per ticket

- Good, because it removes the shared-worktree constraint entirely.
- Bad, because it turns one reviewable branch into N and forces a merge step relay would have to own.
- Bad, because per-ticket parallelism is the multi-item problem, and relay is deliberately single-item.

## More Information

- Provenance: `.scratch/relay-npx-tool/issues/07-orchestration-topology.md`, grilling of 2026-07-24, revised during implementation.
- Related: [ADR-0001](0001-the-harness-owns-the-loop.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
