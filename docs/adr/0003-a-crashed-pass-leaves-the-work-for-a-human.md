# 0003. A crashed pass leaves its work for a human, and relay never touches an existing branch

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

A **pass** can die mid-flight: a container that will not start, a killed process, an agent that never answers.
When it does, there is a half-built **pass branch** on the host, a **work item** sitting In Progress, and a **sandbox** to dispose of.

The obvious autonomous answer is to recover: resume from the commits already there, or reset the branch and start over.
Both are wrong for a tool whose whole thesis is one honest **leg** of the race, then hand the baton to a human.

## Decision Drivers

- The human is the recovery mechanism; relay is not trying to be self-healing.
- Commits relay did not create this pass may carry a human's inspection state, and losing those is worse than refusing to run.
- A re-run after a crash is the normal path, so it must not need a cleanup ritual relay could have done itself — except where safety demands it.

## Considered Options

- **Option A** — Clean restart only: never resume, refuse an existing **pass branch**, leave the **work item** In Progress, comment best-effort, dispose of the **sandbox**.
- **Option B** — Resume: keep a cross-pass ledger of which **tickets** are done and pick up where the crash happened.
- **Option C** — Auto-reset: delete or reset the existing branch and re-run clean without asking.

## Decision Outcome

Chosen option: **Option A**, because resume needs durable cross-pass state that contradicts the ephemeral hand-off every **leg** is built on, and auto-reset can destroy commits relay did not create.

Concretely:

- Every invocation starts fresh — new **sandbox**, fresh **plan** over the item's current tickets.
- An existing **pass branch** is refused outright; the human clears it and re-runs.
- A crash leaves the **work item** In Progress, which is exactly what a re-run expects to find.
  relay never transitions it back.
- On a catchable crash, relay leaves a best-effort comment naming the branch and the failure, then rethrows.
  A comment the tracker will not take must never replace the original error.
- The sandbox is always disposed of, never left running for inspection.
  Progress lives in host-side git commits, not container state.

### Consequences

- Good: no commit relay did not create is ever lost.
- Good: no cross-pass ledger to build, keep correct, or migrate.
- Good: a crashed pass leaves a branch a human can read, fix, or throw away — which is the recovery path.
- Bad: a crash late in a pass wastes every leg before it; the re-run redoes all of them.
- Bad: after a crash the human must delete the branch by hand before re-running.
- Bad: a hard kill runs no cleanup code, so there is no comment — the item simply sits In Progress until someone looks.

### Confirmation

`tests/pass.test.ts` covers the branch-collision refusal, the best-effort crash comment, and disposal of the sandbox on every path.

## Pros and Cons of the Options

### Option B — resume a crashed pass

- Good, because a late crash would not throw away the work already committed.
- Bad, because it needs a durable ledger — tickets done, commit-to-ticket map, gate state — and every **leg**'s hand-off is deliberately ephemeral.
- Bad, because it contradicts the one-pass-then-hand-over thesis: a tool that resumes is a tool that runs unattended for longer.

### Option C — auto-reset the branch

- Good, because a re-run after a crash would need no human step at all.
- Bad, because an existing branch may hold a human's own commits or their inspection of the crash, and relay cannot tell the difference.

## More Information

- Provenance: `.scratch/relay-npx-tool/issues/12-pass-failure-and-recovery-semantics.md`, grilling of 2026-07-24.
- Related: [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
