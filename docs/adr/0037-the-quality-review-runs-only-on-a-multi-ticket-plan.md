# 0037. the quality review runs only on a multi-ticket plan

- **Status:** accepted
- **Date:** 2026-08-03

## Context and Problem Statement

[ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md) added the **quality review** as a **leg** of its own on every **pass**, so that something asks whether the implementation is structurally worth keeping.
Three rounds of `relay rehearse` over all scenarios and both **landings** measured what that leg bought (`rehearsal/runs/loop-2026-08-01T15-49-41.log`).

It ran 18 times, once per pass, 34–83s each, and produced 3 of the loop's 111 **findings**.
The three did not distribute evenly:

- The one structural finding worth the leg — collapsing a `handOut`/`cloneDate` layer by representing a due date as epoch milliseconds — came from a three-**ticket** pass.
- A non-null-assertion cleanup in a test came from another three-ticket pass, and cited the target repo's own `AGENTS.md`, which is the `standards` **axis**'s question rather than this scope's.
- The third came from a single-ticket pass, and ordered the deletion of a helper the same pass's **branch review** had just ordered extracted, blocking the pass ([#40](https://github.com/miwurster/relay/issues/40)).

That last one is the shape of the problem.
On a single-ticket **plan** the branch review already reads `standards` over the whole branch ([ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)), and the rule the quality review cited — no identity wrappers or pass-through helpers — is one the target repo documents for itself.
Two legs were asking one question from opposite directions over the same lines.
On a multi-ticket plan there is no such overlap: `standards` is read per ticket and never over the branch, so the quality review is the only whole-branch structural read the pass gets.

## Decision Drivers

- A leg that costs a run on every pass has to earn it on every pass. One finding in six, one of which was net-harmful, does not.
- Where a scope duplicates an axis another leg already covers, the duplicate is the one to drop — the waste ADR-0027 set out to remove.
- The gate must key off a fact the **harness** already holds. A pass must not have to measure itself to find out which legs it runs.
- A multi-ticket pass must not change at all: it is where the one good finding came from.

## Considered Options

- **Option A** — Leave it. Pay the leg on every pass.
- **Option B** — Fold the quality axis into the branch review as a second lens, dropping the leg.
- **Option C** — Gate the leg on the pass's diff size, above some threshold.
- **Option D** — Gate the leg on the plan's ticket count: run it where a ticket review ran, skip it otherwise.

## Decision Outcome

Chosen option: **Option D**.

- The harness runs the quality stage only where `reviewsEachTicket` is true — the same single fact that already decides the per-ticket round and the branch review's axis set.
- A single-ticket pass goes from its branch review's **re-review** straight to the **green gate**. No **finding** is lost from a stage that no longer runs, because that stage cannot block and its findings were never binding.
- Nothing about the stage itself changes where it does run: it is still handed the pass's **settled findings**, still cannot stop a pass by any means, and is still verified by nothing but the green gate.

Option B was refused because ADR-0027 split the two scopes precisely to stop one prompt carrying two questions, and the vendored rubric is the larger half of that prompt.
The measured duplicate finding is evidence the axes already bleed; merging the legs would make that worse rather than better.

Option C was refused because the evidence does not support it over Option D.
The loop's findings vary by ticket count, which is what its scenarios vary by; diff size is a proxy for it that nothing in relay measures today.
It would cost a diff measurement, a threshold in `.relay/config.ts`, a `relay doctor` line to report the resolved threshold, and a number 18 passes cannot justify — for the same selectivity Option D gets from a boolean the harness has already computed.

### Consequences

- Good: across the measured loop the leg runs 6 times instead of 18, keeps the one finding that was worth it, and drops the one that blocked a pass.
- Good: no new configuration, no new fact for a pass to compute, and no `doctor` surface. One condition on an existing call site.
- Good: the two legs that disagreed over the same lines can no longer both run.
- Bad: a single-ticket pass has nobody asking the wide structural question — whether a layer deserves to exist, whether a file grew past a size anyone will read. `standards` asks the hunk-local version of it and will not order a restructure. Accepted: the one time the leg did fire on a single-ticket pass it was net-negative, and the axis is still read.
- Bad: the gate is a proxy. A single-ticket item that turns out large gets no structural read, and a three-ticket item of trivial diffs pays for one. Accepted: ticket count is the plan's own shape and the harness's own fact, where diff size is neither.

### Confirmation

`tests/pass/harness-quality.test.ts` asserts a multi-ticket plan reaches the quality scope and a single-ticket plan never does, and that a single-ticket pass runs its re-review straight into the green gate.
Its existing assertions about the stage — the settled findings it is handed, the degrade when either of its legs fails to answer, the pass that lands with a declined quality finding — move onto multi-ticket plans, which is the only shape that now reaches it.

## More Information

- Amends [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md), whose quality leg ran on every pass.
- Related: [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md), which is why a single-ticket pass still reads `standards` after this.
- Related: [ADR-0036](0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md), whose degrade rules are untouched: they describe the stage, not whether it runs.
- Provenance: [#42](https://github.com/miwurster/relay/issues/42), and the 3-round rehearsal loop of 2026-08-01 it measured.
