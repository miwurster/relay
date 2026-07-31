# 0022. A fix is verified once, and never looped

- **Status:** accepted
- **Date:** 2026-07-29

## Context and Problem Statement

[ADR-0021](0021-spec-findings-are-binding.md) makes a spec **finding** binding: a fixer that declines one stops the **pass**.
That closes the case where the fixer says *no*. It says nothing about the case where the fixer says *yes* and is wrong.

A ticket-scope fix is at least read again — the branch review reads the whole branch, the fixer's commit included.
A branch-scope fix is read by nothing. The **green gate** runs next, and the gate is objective: it catches a broken build, not "you addressed the wrong half of what the item asked".
So the pass's last spec judgement was made against code that then changed, and the change was never judged.

The question this ADR settles is whether a fix gets re-reviewed, and how many times.

## Decision Drivers

- The failure mode is exactly the one ADR-0021 exists to prevent, arriving by the other door. Guarding one and not the other is half a guarantee.
- The branch review is the widest read, the only review measured against the whole **work item**, the only one that reads a fixer's commit, and the only one that runs on every pass — a single-ticket plan drops the ticket review entirely.
- The README rules out runaway loops. Only the gate earns a loop, and it earns it because its verdict is objective.
- A review is the pass's most expensive leg, so a round of review-and-fix that a clean pass pays for is a round wasted on most passes.
- A re-review that hands its findings to a fixer needs another re-review to verify *that* fix, and so on. Any cap on that is arbitrary; the honest choices are one look or an admitted loop.

## Considered Options

- **Option A** — No re-review. The fixer commits and is trusted.
- **Option B** — One re-review of the branch scope, conditional on the branch review having produced findings and the fixer having changed something. Report-only.
- **Option C** — A bounded review-and-fix loop, capped like the gate at two attempts.

## Decision Outcome

Chosen option: **Option B**.

- After the branch review's fixer leg, if that leg fixed anything, the branch review runs **once more** over the new HEAD.
- It is the same **role**, the same prompt, the same model and the same diff range. The only thing that differs is its name, and it has to differ: each review writes a findings file, and the second must not overwrite the first's.
- `ReviewScope`'s branch arm carries `rereview: boolean` for that, so the harness states which run it is asking for at both call sites.
- The re-review is **report-only**. There is no fixer leg after it, so its findings reach nobody:
  - a **spec** finding blocks the pass, by the same rule as everywhere else;
  - a **standards** finding is reported to the **handover** and the pass lands.
- It does not run when the branch review found nothing, or when the fixer declined everything it was handed. Nothing changed, so there is nothing new to read — and a fixer that declined everything has already been accounted for.
- Ticket-scope fixes get no re-review of their own. The branch review already reads them, which is what it is for.

Option C was refused rather than deferred. The blocking rule stays the single rule ADR-0021 defines, with no exception carved for a second round, and a review loop is the autonomy theatre relay's README rules out.

### Consequences

- Good: no fix reaches the human's branch without something having read it against the item's intent.
- Good: a clean pass pays nothing. The extra leg only runs on passes whose branch review actually wanted something changed.
- Good: the blocking rule needs no new case. `blockFor` is called on the re-review's findings exactly as it is called on a fixer's declines.
- Bad: a standards problem the fixer's own commit introduced is reported and then landed. Accepted: blocking on it would let a nit the fixer created stop an otherwise-green pass, which inverts the axis distinction ADR-0021 just built.
- Bad: a spec problem the re-review misses still lands green. Accepted at one round — the alternative is a loop, and a loop's last round is unverified too.
- Bad: gate-loop fixes change code and are verified only by the gate re-run, which is spec-blind. This ADR does not close that; it is named here so the next reader does not have to rediscover it.

### Confirmation

`tests/pass/harness-rereview.test.ts` asserts the re-review runs after a fix that changed something, does not run when the branch review found nothing, does not run when the fixer declined everything, blocks on a spec finding it raises, and lands while reporting a standards finding it raises.
`tests/crew/roles/reviewer.test.ts` asserts the re-review's findings file is `branch-review-rereview.json` and its prompt arguments are identical to the first run's.
Exactly one fixer leg runs per branch review: the test on a blocking re-review counts them.

## Pros and Cons of the Options

### Option A — no re-review

- Good, because it is free and it is what the code already did.
- Good, because the gate still runs afterwards, so a fix that broke the build is caught.
- Bad, because the gate is objective and the risk is not. The pass's last spec judgement would be made against code that then changed.
- Bad, because it makes ADR-0021's guarantee cover only half the failure it names.

### Option C — a bounded review-and-fix loop

- Good, because a re-review could hand its findings on rather than only reporting them.
- Good, because it is symmetric with `driveGate`, which is already a capped loop.
- Bad, because it costs up to four extra legs on the pass's most expensive role.
- Bad, because the last round is unverified whatever the cap is, so it buys iterations rather than a guarantee.
- Bad, because a review that loops reads as relay deciding when it is done, which is the thing relay is built not to do.

## More Information

- Provenance: the grilling of 2026-07-29 on relay's review legs.
- Related: [ADR-0021](0021-spec-findings-are-binding.md) — the other half, on what an unaddressed finding costs.
- Related: [ADR-0001](0001-the-harness-owns-the-loop.md) — why the topology is the harness's and not a role's.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
