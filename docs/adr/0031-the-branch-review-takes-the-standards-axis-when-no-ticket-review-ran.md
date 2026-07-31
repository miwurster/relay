# 0031. the branch review takes the standards axis when no ticket review ran

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

[ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md) left the whole-branch **review** asking the `spec` question alone, on the grounds that the **ticket** scope already reads `standards` and the **quality review** asks the wider structural question.

A single-ticket **plan** drops the per-ticket review entirely: its one ticket *is* the **work item**, so the two scopes would ask the same question over the same diff.
Put those two decisions together and a single-ticket **pass** never reads the `standards` **axis** at all.
Nothing else covers it: the **green gate** catches what lint and the type-checker catch, and the quality review judges structure against a vendored rubric, not against the conventions this repo documents for itself.

So the two scenarios `relay rehearse` runs over — a bug report and a small spec, both childless items — are exactly the passes that land without anyone having asked whether the change follows the repo's own conventions.

## Decision Drivers

- The axis is either covered on every pass or it is not covered at all. A guarantee that holds only for multi-ticket items is not one a human can rely on when they read a **handover**.
- The reason ADR-0027 gave for `spec` alone was double-reporting, and the reason it holds is the ticket review — not the quality review, which answers a different question and does not subsume documented-convention breaches.
- A multi-ticket pass must not gain a second `standards` read. The same finding reaching the **fixer** from two legs is the waste ADR-0027 removed.
- Whatever the first branch run is asked for, its **re-review** has to be asked for the same: that run is the pass's only look at the fixer's own commit.

## Considered Options

- **Option A** — Leave it. Document that `standards` is a multi-ticket-only axis.
- **Option B** — Keep the per-ticket review on a single-ticket plan and drop the branch review instead.
- **Option C** — Give the branch review both axes on a single-ticket plan, and `spec` alone otherwise.
- **Option D** — Give the branch review both axes on every plan.

## Decision Outcome

Chosen option: **Option C**.

- `ReviewScope`'s branch arm carries `axes: "both" | "spec"`, so the **harness** states at the call site which set it is asking for.
- The harness derives it from the one fact that already decides the per-ticket round: `reviewsEachTicket`. Each ticket reviewed → the branch review reads `spec`; no ticket reviewed → it reads both.
- The re-review is handed the same `axes` as the run it re-reads.
- The reviewer's prompt text and answer schema move into one table keyed by axis set, because they are the same fact stated twice and a branch review now picks its entry at runtime.
- `review.md`'s `spec`-only instruction now names the ticket review as the axis's owner, which is what it is; it used to name the quality review, which this ADR contradicts.

Option B was refused because the re-review is bolted to the branch stage: dropping that stage would send a spec fix into the objective gate unread, which is the hole [ADR-0022](0022-a-fix-is-verified-once.md) exists to close.
Option D was refused because it re-introduces the double read for every multi-ticket pass, at the cost of the one axis set this ADR adds.

### Consequences

- Good: every pass reads `standards`, whatever its plan's shape. The two rehearsal scenarios now exercise the axis they never did.
- Good: no leg is added, no leg is removed, and no multi-ticket pass changes at all.
- Good: prompt text and schema can no longer drift apart on which axes a run was asked for — an axis missing from the prompt is a key the schema rejects.
- Bad: a single-ticket pass's branch review answers on both axes over the whole branch, so the model does more in one run than it did. Accepted: it is one run either way, and the alternative is a second review leg.
- Bad: on a single-ticket pass a `standards` finding the re-review raises is reported and landed, since a re-review reaches no fixer. Accepted: [ADR-0022](0022-a-fix-is-verified-once.md) already settles that a non-binding finding from that run is reported rather than blocking.

### Confirmation

`tests/pass/harness.test.ts` asserts a single-ticket plan asks both branch runs for `both`, and a two-ticket plan asks both for `spec`.
`tests/crew/roles/reviewer.test.ts` asserts the `both` branch scope is asked for both axes, that its `standards` finding is stamped with `branch-review` and no ticket, and that an answer on `spec` alone is refused.

## More Information

- Amends [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md), whose "the whole-branch review now asks the `spec` question alone" holds only where a ticket review ran.
- Related: [ADR-0022](0022-a-fix-is-verified-once.md), whose re-review now carries whichever axes its first run was asked for.
- Provenance: the grilling of 2026-07-31 on what a single-ticket pass actually reviews.
