# 0025. The ready label is consumed by the pass that acts on it

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

`ready-for-agent` is a human's offer of a **work item** to an agent.
The **frontier** query filters on it and the **eligibility check** gates on it, both through the one `READY_LABEL` constant.

Nothing ever removed it.
The **planner** adds `agent-in-progress`, and the **handover** swaps that for `agent-in-review` under `pull-request` **landing** — and there the item stops: open, because closing is the human's once they merge, and still labelled ready.

Every gate the eligibility check applies then passes again the moment the pass ends.
The ready label is present, the item is no longer **held**, it is still open, and it has no **open blocker**.
So `npx @miwurster/relay` picks the same item straight back up and runs a second **pass** over work whose pull request is sitting in review, from a fresh **pass branch**, re-implementing all of it.
`agent-in-review` does not stop this: it is a label for humans, and nothing in `src/` reads it.

The same mechanism reaches one level down.
Sub-issues are commonly labelled ready too — relay's own **rehearsal** seeds them that way — and the frontier is a flat query over every open issue carrying the label, with no filter for whether an issue is somebody's child.
A **ticket** that keeps the label after its pass is therefore eligible as a work item in its own right.

What this ADR settles is the lifetime of the ready label.

## Decision Drivers

- The worst outcome here is not staleness, it is repetition: a second pass re-implements finished work and opens a second pull request against the first one's.
- The label means an offer, and an offer that has been taken up is spent. Re-offering is a judgement about work a human has now seen.
- One rule that covers the work item and its tickets beats two rules that agree by coincidence — the same argument that gives `READY_LABEL` one constant.
- Whatever fixes this has to hold under `pull-request` **landing**, where relay never closes the item and has no leg after the human's merge.
- An `early-bail` consumed nothing: the planner refused before any code was written, and the item is exactly as eligible as the human left it.

## Considered Options

- **Option A** — the **handover** strips `ready-for-agent` from the work item and from every ticket it writes, on every **outcome** except `early-bail`.
- **Option B** — the **eligibility check** additionally treats `agent-in-review` and `agent-blocked` as disqualifying, and no label is stripped.
- **Option C** — the frontier excludes any issue that is another issue's sub-issue, fixing the ticket half only.
- **Option D** — the ready label survives a **blocked** pass, so a re-run can pick the item up once a human has fixed what blocked it.

## Decision Outcome

Chosen option: **Option A**.

The ready label is consumed by the pass that acts on it.

- The handover removes `ready-for-agent` from the **work item** on `success` and on `mid-block`, alongside the label swap it already does.
- It removes the same label from every ticket it writes, which is every **finished ticket** and, on a `mid-block`, the ticket that blocked.
- On `early-bail` it removes nothing: nothing was consumed, and `agent-blocked` is what tells the human to look.
- The **eligibility check** is unchanged. It still gates on the ready label, the hold, the open state and open blockers, and reads no new label.

Re-offering an item is a human's act, and it is the same act it always was: apply the label again.

**Option B** was rejected as the fix, though it is the more defensive one.
It leaves two labels quietly meaning "not really ready" while the label that says ready still says it, and it grows the eligibility check for a condition the tracker could simply not be in.
It also fixes nothing about the ticket case: a ticket that keeps the ready label carries neither `agent-in-review` nor `agent-blocked`.

**Option C** was rejected because it treats a symptom of the ticket case and needs the sub-issue graph at frontier time to do it, when the parent relation is not what makes a finished ticket ineligible — the spent offer is.

**Option D** was rejected because `agent-blocked` already marks an item a human has to look at, and a blocked pass is the case where an unattended re-run is least wanted: the same block is the likeliest outcome.

### Consequences

- Good: an item cannot be re-picked while its own pull request is in review, and a finished ticket cannot be picked as a work item at all.
- Good: one rule states the label's lifetime, for parents and children alike.
- Good: `relay` run with no argument becomes safe to run repeatedly — the frontier drains rather than looping over its first entry.
- Bad: a human who wants a second pass over an item must re-apply the label. Deliberate: the second pass is a decision, and it is now made by someone who can see the first one's result.
- Bad: a crashed pass strips nothing, because no handover ran. The item keeps both `ready-for-agent` and `agent-in-progress`, and the hold is what keeps it ineligible until a human clears it ([ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md)).
- Bad: the strip is a **leg**'s act, so a handover that skips it leaves the item eligible again. Nothing checks that it happened, per the cost ADR-0018 already accepts.

### Confirmation

`tests` cover a `success` and a `mid-block` handover asserting the ready label is stripped from the work item and from the tickets written, and an `early-bail` asserting it is not.
The eligibility check's own tests are unchanged, which is the assertion that Option B was not smuggled in alongside.

## More Information

- Provenance: the grilling of 2026-07-31 on ticket-level tracker state.
- Related: [ADR-0026](0026-the-handover-writes-ticket-state.md) — the other half of the same session: what the handover writes on a ticket.
- Related: [ADR-0011](0011-init-creates-the-label-vocabulary.md) — where the label comes from.
- Related: [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md) — why a crash leaves the labels alone.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
