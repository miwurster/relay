# 0029. a pull request closes the work item too

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

[ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md) settled that relay never writes a closing keyword against a parent, so a pull request carries `Closes #<child>` per **ticket** it committed and nothing else.
It recorded the cost as deliberate: "a **work item** stays open after its pull request merges, so someone must close the parent."

Nothing closes it for them.
GitHub does not close a parent when its sub-issues close — all children closed shows `n of n` on the parent and leaves it `open` — and under `pull-request` **landing** the **handover** closes nothing at all, because closing follows the merge and the merge is a human's.
So every multi-ticket **pass** that lands as a pull request leaves a work item open behind it, and the human who merges has to remember an issue the pull request never mentioned.

## Decision Drivers

- The **handover** publishes what the pass earned; a work item every ticket of which is built and merged is earned.
- A human reads the pull request body before merging, and can edit it.
- What relay writes must be something a human can see and correct in GitHub's own UI.
- relay must not claim a specific unit of work was done when it knows it was not.

## Considered Options

- **Option A** — Keep ADR-0008's rule: tickets only, and a human closes the work item.
- **Option B** — `Closes #<work item>` only when every sub-issue is either already closed or among the pass's **finished tickets**, computed on the host.
- **Option C** — `Closes #<work item>` always, on every pull request a pass opens.
- **Option D** — Option C plus a `Closes` line for every sub-issue, built or not.

## Decision Outcome

Chosen option: **Option C**.

The body carries one `Closes` line per committed ticket, as before, **and one for the work item, unconditionally** — on a `success` pull request and on a `mid-block` draft alike.

Unconditional rather than Option B's condition, because the condition would be a *prediction*, not a fact.
relay decides at handover time and the merge happens later; a sub-issue added in between turns a correct line into a wrong one silently, and buying that with a host-side computation and an as-of sentence in the body pays for a guarantee it cannot keep.
The reviewer is the gate that actually holds: they have the branch and the sub-issue tree in front of them, and deleting a line from a body is cheaper than remembering an issue nobody named.

**Tickets stay committed-only.**
Option D was rejected outright: a `Closes #12` on a ticket nobody implemented is a claim about one unit of work, with nothing in the diff to prompt the reviewer to spot it, and the failure is silent — GitHub closes it on merge and the work is lost.
relay knows which tickets it committed, so writing a line it knows is false is the one thing the prompt still forbids.
For the same reason no "not built by this pass" list is added either: the sub-issue tree on the work item already shows it.

This supersedes ADR-0008's bullet that relay never writes a closing keyword against a parent, and the consequence that a human must close it.
The probe behind that bullet stands — GitHub still neither refuses nor cascades — but what it makes wrong is *relay* deciding to close a parent over open children, not a human deciding to.

### Consequences

- Good: a pull request that closes everything it earned, so a merged pass leaves no work item open for someone to notice later.
- Good: no new placeholder, no host-side computation, no branch in the prompt — the work item is already `{{WORK_ITEM}}`.
- Bad: merging a pass that built some of the tickets closes the work item over its open children, which then show as `1 of 3` under a closed parent. The reviewer must edit the body, and nothing warns them if they do not.
- Bad: a `mid-block` draft carries the line too, so merging it closes the work item though relay never saw the branch green.
- Bad: the work item can end up closed while still labelled `agent-blocked`, which reads as unfinished until a human strips the label.
- Bad: relay now writes one line whose correctness it cannot check, which is a category it had none of before.

### Confirmation

`tests/crew/roles/handover.test.ts` asserts the prompt gives `{{WORK_ITEM}}` a `Closes` line of its own whatever `{{COMMITTED_TICKETS}}` holds, that it is written once where the item is its own single ticket, and that an unbuilt sub-issue is left to the human merging.
The same suite covers the base-branch caveat, which now names the work item alongside the tickets.

## Pros and Cons of the Options

### Option A — tickets only

- Good, because relay writes nothing it cannot verify.
- Bad, because the work item is left to a human's memory, prompted by nothing.

### Option B — close the work item under a condition

- Good, because the line is right at the moment relay writes it.
- Bad, because it is right *then* and fires *later*, and a sub-issue added in between makes it wrong with no signal.
- Bad, because it costs a host-side computation and an as-of sentence to protect a case the reviewer already owns.

### Option D — close every sub-issue

- Good, because the tracker ends up fully closed with no follow-up at all.
- Bad, because it closes work that was never done, silently, and per ticket.

## More Information

- Provenance: grilling of 2026-07-31.
- Supersedes: [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md), the parent-closing bullet only.
- Related: [ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md) — why a `Closes` line may not fire at all; [ADR-0026](0026-the-handover-writes-ticket-state.md) — why closing under `merge` landing is the handover's own act and stays conditional.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
