# 0033. A protocol slip gets one retry, a work failure gets none

- **Status:** accepted
- **Date:** 2026-08-02

## Context and Problem Statement

Every leg of a pass ends by emitting one `<tag>…</tag>` block holding JSON that fits the role's schema.
The generic role runner reads that block, and a leg whose block is missing, is not JSON, or does not fit the schema raises a `RoleError` that blocks the pass.

The rehearsal run `single-spec-merge-2026-08-01T20-12-20` blocked on `fixer-quality emitted no <relay-fix> block.` and its digest listed seven legs — every leg of the pass except `fixer-quality`.
The record is written after the block is parsed, so the one leg that explains the outcome is the one leg that leaves nothing behind.
What the fixer actually said survived only in `.sandcastle/logs/agent-136-fixer-quality.log`, inside a sandbox that is disposed of when the pass ends.

Underneath the missing record is a second thing the runner cannot tell apart.
A role that did the work and then narrated its answer instead of tagging it, and a role that could not do the work at all, produce the same outcome: the pass blocks, a human picks it up.
The first is a slip in how the answer was delivered.
The second is the answer.

## Decision Drivers

- The leg a pass blocks on is the leg a human most needs to read. Recording only well-formed answers records everything except the failure.
- The sandbox's log file is not a record: it is inside a disposable worktree, and the digest — the artefact a rehearsal is read through — is built from records.
- A protocol slip is cheap to correct and expensive to escalate. The work is already done; only its packaging is wrong.
- A retry that re-runs the role from scratch is a different leg, not a correction: it would re-read a branch the first attempt may already have changed, and pay for the work twice.
- Retrying a role that genuinely cannot do the work buys nothing and hides the block behind another leg's cost.

## Considered Options

- **Option A** — Record the failure; no retry.
- **Option B** — Record the failure, and resume the same session once with what was wrong.
- **Option C** — Record the failure, and re-run the leg cold once.

## Decision Outcome

Chosen option: **Option B**.

- The status record shape gains a second arm: a leg either recorded an `answer`, or recorded a `failure` sentence and every attempt's raw `stdout`. Every leg that ran leaves a record either way.
- Both attempts' output is kept, not just the last. A role that narrated its answer instead of tagging it said the substantive thing on its first attempt, so a record holding only the terse retry would lose what the human came to read.
- The digest squashes a leg's status phrase to one line, because a schema failure carries zod's own pretty-printed message and a leg is one line of a table.
- A leg whose answer does not parse gets exactly one more iteration of the **same** agent session, through `SandboxRunResult.resume(prompt)` — same sandbox, same worktree, no second prompt file. The retry prompt names the failure and the tag, and asks for the answer again rather than for the work again.
- The retry runs under a fresh `AbortSignal.timeout(roleTimeoutMs)`: the same configured budget the first attempt had, counted from when the retry starts.
- Commits from both attempts are counted together before the leg's branch rule is judged, so a `must-commit` leg that committed on its first attempt and a `read-only` leg that committed on its second are both judged on what the leg as a whole did.
- `resume` is optional on the run result — absent when the provider cannot resume. Absence means no retry is available, and the leg fails exactly as it does today.
- A second failure raises the same `RoleError` on the same message, so the pass blocks and exits as it did before.
- Nothing else retries. A timeout, a crashed agent, a red gate and a branch-rule breach all keep today's behaviour. One retry, not configurable.

The rule this states is a line between two kinds of failure: **how** the answer was delivered gets a second chance, **what** the answer says does not.

Option A was refused because the slip it leaves on the table is the cheapest failure relay has and the most annoying one to hand a human.
Option C was refused because a cold re-run is a second leg, not a correction: it re-reads a branch its own first attempt may have moved, and pays the role's full cost to fix a formatting mistake.

### Consequences

- Good: the digest can always explain the block. The leg that failed is listed, with its failure as its status phrase and its raw output on disk.
- Good: a pass that would have blocked on a narration slip now continues, on the answer the role already had.
- Good: the retry lives in the one generic role runner, so every role has it and no role module owns retry logic.
- Bad: a role that emits no block because it never finished the work now costs one extra iteration before the pass blocks. Accepted: one iteration against a whole abandoned pass.
- Bad: a leg's failure record holds every attempt's raw agent output, which can be long. Accepted — it is the only copy that outlives the sandbox.
- Bad: the retry can commit, and its commits count towards the leg's branch rule. That is intended, and it is why the counts are summed rather than replaced.

### Confirmation

`tests/crew/run-role.test.ts` asserts that a missing block, a block that is not JSON, and a block that fails its schema each record a failure with the raw output and each resume the session once; that a retry which parses returns the second answer and records it as the leg's only status; that a leg failing twice raises the same `RoleError`; that the retry prompt names the tag; that commits from both attempts are counted together for the branch rule; that a run result without `resume` fails without retrying; and that a failure record holds both attempts' output.
`tests/rehearsal/digest.test.ts` asserts that a failure record is listed as a leg with its failure text as its status, that a multi-line failure stays one line, and that neither is listed under "Unparseable records".

## Pros and Cons of the Options

### Option A — record the failure, no retry

- Good, because it is the smaller change, and it alone fixes the digest.
- Bad, because it leaves a pass blocking on a formatting mistake the role could have corrected in one sentence.

### Option C — record the failure, re-run the leg cold

- Good, because it needs nothing from the provider: no `resume`, no session capture.
- Bad, because the second attempt reads a branch the first attempt may already have changed, so it is not the same leg twice.
- Bad, because it pays the role's whole cost again to recover an answer that already exists.

## More Information

- Provenance: rehearsal run `rehearsal/runs/single-spec-merge-2026-08-01T20-12-20.txt`, and issue [#41](https://github.com/miwurster/relay/issues/41).
- Related: [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md) — relay drives a long-lived per-pass sandbox, which is why the retry is `SandboxRunResult.resume` rather than sandcastle's `run({ output: { maxRetries } })`.
- Related: [ADR-0012](0012-a-legs-facts-stay-next-to-the-leg.md) — a leg's facts, including its failure, stay next to the leg.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
