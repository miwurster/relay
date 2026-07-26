# 0001. The harness owns the loop, and every role is a top-level cold session

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

A **pass** runs six **roles** over one **work item**.
Something has to own the order they run in, and the choice decides what each role *is*.

The predecessor tool, kipu-afk, ran one long-lived umbrella agent that spawned the other roles as Task-tool subagents.
That arrangement has a specific, fatal cost: a skill invoked inside a subagent cannot spawn its own subagents, so the review skills degrade into inline rubrics rather than running as designed.
The whole point of relay is that the review **legs** run at full strength.

## Decision Drivers

- A **role** must be able to invoke a skill that itself spawns agents.
- Roles must not inherit each other's conversation, so nothing leaks between **legs** except what was deliberately written down.
- The orchestration graph must be readable, testable and diffable without running a model.

## Considered Options

- **Option A** — The TypeScript harness owns the loop; each **role** is a top-level agent process (`sandbox.run`).
- **Option B** — A persistent in-**sandbox** planner drives the loop and spawns the other roles as its own subagents.
- **Option C** — Hybrid: the harness starts the pass, the planner drives the per-**ticket** inner loop.

## Decision Outcome

Chosen option: **Option A**, because only a top-level agent process can run the review skills at full strength, and that is the capability the whole tool exists to deliver.

The planner is therefore one-shot: it reads the tracker, ensures the **work item** is In Progress, returns an ordered list of **tickets**, and exits.
It does not drive anything.
The harness iterates that list and dispatches every subsequent **leg** itself.

### Consequences

- Good: every **role** runs its skills at full strength, which is the tool's reason to exist.
- Good: the topology is plain TypeScript — `src/harness.ts` is testable against a fake **crew**, with no model, network or container.
- Good: every **leg** is a **cold session**, so a role cannot be contaminated by an earlier role's reasoning.
- Bad: nothing passes between roles but files, git history and small values, so anything a role needs from an earlier one must be made explicit — the harness cannot just "tell it".
- Bad: the topology is fixed in code, so changing the graph is a code change rather than a prompt change.

### Confirmation

`tests/harness.test.ts` drives the whole topology against a recording **crew** and asserts the exact order of **legs**.

## Pros and Cons of the Options

### Option B — persistent in-sandbox planner

The planner stays alive for the whole **pass** and spawns implementers, reviewers and fixers as Task-tool subagents.

- Good, because the planner holds context across the whole pass and can adapt the plan as it goes.
- Good, because it is closer to how an operator would drive the work by hand.
- Bad, because subagent-hosted skills cannot spawn, so the review skills degrade to inline rubrics — the exact failure relay was built to fix.
- Bad, because the orchestration becomes a prompt, not code: untestable and undiffable.

### Option C — hybrid

- Good, because the harness keeps the outer contract while the planner keeps per-**ticket** context.
- Bad, because it inherits Option B's degradation for every role inside the inner loop, which is where the reviewers live.

## More Information

- Provenance: `.scratch/relay-npx-tool/issues/07-orchestration-topology.md`, grilling of 2026-07-24.
- Related: [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
