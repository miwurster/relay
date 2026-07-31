# 0026. The handover writes ticket state, and a tick is a claim

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

A **ticket** was pass-local and ephemeral: relay read it and wrote nothing back.
A human watching the tracker during a **pass** therefore saw one label on the **work item** and nothing else — no sign of which ticket was being built, and afterwards no sign on the tickets that a pass had happened at all.

Three things were missing.
A ticket never showed that an implementer **leg** was running over it.
The acceptance-criteria checkboxes in a ticket's body were never ticked, on any **landing**.
And under `pull-request` landing, tickets close only because the pull request body carries a `Closes` line per ticket — which GitHub honours only when the pull request merges into the repo's *default* branch, while relay's **base branch** is whatever the operator had checked out ([ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md)).

The question is which **role** writes a ticket's state, and what a ticked box asserts.

The tempting answer is a per-ticket handover leg: the ticket loop already implements, reviews and fixes one ticket before starting the next, so a leg at the end of that loop would mirror the pass's own handover one level down.

## Decision Drivers

- The **green gate** runs once, over the whole branch, after every ticket. Nothing is verified per ticket; the per-ticket review is a review, not a gate.
- The branch review and the **re-review** run after the last ticket and can raise a **binding** finding against any ticket, which blocks the pass ([ADR-0021](0021-spec-findings-are-binding.md)).
- Tracker state that says done for code that never lands is worse than no state at all. The handover is careful about exactly this today: a `mid-block` closes nothing, because the work reached nobody but the pass.
- Every leg is a **cold session** — a whole agent process. Two `gh` calls is a strange thing to spend one on.
- A leg is trusted to write what it is told to write, and relay cannot check that it did. A leg told to *derive* what to write gets it wrong more often, which is why `COMMITTED_TICKETS` is handed over as a fact and the prompt says never to work the list out.
- GitHub exposes no per-checkbox API and no conditional body update: ticking means reading a body and rewriting it whole.
- A repo's body conventions are the repo's. relay states none of them, per [ADR-0009](0009-the-repos-docs-declare-the-green-gate.md) and [ADR-0018](0018-legs-read-the-tracker-themselves.md).

## Considered Options

- **Option A** — the **implementer** applies `agent-in-progress` to its own ticket, and the **handover** writes everything else, on `success` and on `mid-block`.
- **Option B** — a ticket-handover **leg** at the end of each pass through the ticket loop.
- **Option C** — the **harness** writes ticket state host-side after each ticket's review and fix, through `GitHubClient`.
- **Option D** — the implementer writes its own ticket's state, ticks included, when it commits.

## Decision Outcome

Chosen option: **Option A**.

- The implementer applies `agent-in-progress` to its ticket before it starts, and makes no other tracker write. This is the planner's own act one level down: the planner holds the work item, the implementer marks the ticket it is on.
- The handover removes that label and writes what the pass earned. It is the only role that runs after every review and the green gate, so it is the only one whose write can mean anything stronger than *claimed*.
- **A tick is per-ticket, never per-criterion.** The handover ticks every unchecked box in a **finished ticket**'s body, or none of them. It does not judge criteria one at a time: that re-litigates the review with less information and no diff in front of it.
- Every unchecked box counts, whatever heading sits above it. relay hardcodes no `## Acceptance criteria` convention and asks the repo's tracker doc for none.
- Under `merge` landing the handover closes the finished tickets, as it already did. Under `pull-request` landing it labels them `agent-in-review` and closes nothing: closing is the human's once they merge.
- On `mid-block` it writes the finished tickets too — boxes ticked, `agent-in-progress` removed, no label added, nothing closed. The blocking ticket keeps `agent-in-progress` and gains `agent-blocked`.
- Which tickets are finished is the harness's fact, not the leg's judgement: `COMMITTED_TICKETS` holds a ticket from the moment its implementer returns, *before* its review runs, so on a `mid-block` it contains the ticket that blocked. The harness derives **finished tickets** — committed, minus any ticket carrying an unaddressed **binding** finding — and hands them over as their own list.
- Binding is the right filter and a broader one is wrong. An unaddressed `standards` or `quality` finding is an override the pass lands with ([ADR-0021](0021-spec-findings-are-binding.md)), so excluding its ticket would leave work that landed unclosed. On a `success` pass no binding finding is outstanding, so finished equals committed; on a `mid-block` the difference is exactly the ticket that blocked.
- Where the base branch is not the repo's default branch under `pull-request` landing, the handover says so in the pull request body and in its report. The `Closes` lines will not fire, and a human is owed that fact at the moment they are looking at it.

**Option B** was rejected, and rejected rather than deferred, because the leg it proposes cannot know what it would be asserting.
It runs before the green gate has ever run and before the branch review exists, so its tick claims verification the pass has not performed, and a later binding finding contradicts it on a ticket already marked done.
It writes done-state for code that a `mid-block` may leave unlanded and, under `pull-request`, unmerged forever — the rule today's handover honours by closing nothing.
It also spends a cold session per ticket on two `gh` calls, and it would fire in a single-ticket pass where no ticket review runs at all, marking entirely unreviewed code as reviewed.

**Option C** was rejected as Option B's semantics at a fraction of the cost but with the same defect: it writes at a moment when nothing is verified.
It would additionally make relay's own code a tracker writer for the first time — every issue-label write today is a leg's act — for a benefit the chosen option gets from a leg that already runs.

**Option D** was rejected because the implementer has not been reviewed. Its ticks would be a self-report, and a reviewer's `spec` finding would then land on a ticket whose boxes already read done.

### Consequences

- Good: a human watching the tracker sees which ticket is being built, and afterwards sees on each ticket what the pass claimed and did.
- Good: a `mid-block` no longer leaves the tickets it did finish looking untouched.
- Good: no new **role**, no new session per ticket, and no tracker write in relay's own code.
- Good: the coarseness is bounded. A criterion the pass silently missed is ticked with the rest, and the only thing that would have caught it is a `spec` finding, which is binding and blocks the pass.
- Bad: a tick under `pull-request` landing precedes any human's acceptance. A rejected pull request leaves ticked boxes and an `agent-in-review` label behind, and clearing them is the human's — relay has no leg after a merge it does not perform.
- Bad: ticking rewrites a ticket's body, so a human editing that body during the pass loses the edit. GitHub offers no conditional update.
- Bad: a crashed pass leaves `agent-in-progress` on a ticket as well as on the work item, so what a human has to clear is now longer.
- Bad: tracker writes are now spread across three roles — planner, implementer, handover. That is the cost of putting each write in the leg that knows the fact behind it.

### Confirmation

`tests` cover the harness deriving finished tickets on a `mid-block` where the blocking ticket is in `COMMITTED_TICKETS`, and the handover's arguments carrying that list rather than the committed one.
The implementer's prompt permits exactly one tracker write, asserted with its placeholders per role as [ADR-0018](0018-legs-read-the-tracker-themselves.md) requires.
No prompt resource names a body heading; `git grep -n "Acceptance criteria" src/` is empty.

This supersedes ADR-0018's Confirmation line reading "`GitHubClient` is used by the host's work-item selection and labelling only, never by a role."
That line described a host-side label write which does not exist: `GitHubClient` creates the label vocabulary and reads issues, and every issue-label write is a leg's.
ADR-0018's decision — that legs read the tracker themselves and no prompt carries tracker content — is untouched.

## More Information

- Provenance: the grilling of 2026-07-31 on ticket-level tracker state.
- Related: [ADR-0025](0025-the-ready-label-is-consumed-by-the-pass-that-acts-on-it.md) — the other half of the same session: the label's lifetime.
- Related: [ADR-0021](0021-spec-findings-are-binding.md) — why a binding finding can contradict a per-ticket claim.
- Related: [ADR-0018](0018-legs-read-the-tracker-themselves.md) — who reaches the tracker, and what a prompt may carry.
- Related: [ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md) — why the `Closes` lines cannot be relied on.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
