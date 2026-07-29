# 0021. Spec findings are binding, standards findings are not

- **Status:** accepted
- **Date:** 2026-07-29

## Context and Problem Statement

Both of relay's reviews run the same skill, which reports on two axes: whether the change follows this repo's standards, and whether it built what the item asked for.
The reviewer flattened both into one `string[]`, so the axis was gone by the time anything downstream could act on it.
The fixer then answered once for the whole list — `fixed`, or `nothing-to-fix` with a reason — and that reason went to `console.log` and nowhere else.

Two things followed from that. A fixer could decline every finding a review raised and the pass would still land green, because only the objective **green gate** could block. And nobody would ever know: no **leg record**, no **handover** line, one line of stdout that scrolled past.

The question this ADR settles is what an unaddressed **finding** costs the **pass**, and who decides it.

## Decision Drivers

- A branch that does not do what the item asked is the worst thing relay can land. A branch that landed with one standards call overridden is not in the same category.
- The two axes do not weigh the same, so a design that cannot tell them apart cannot act on either correctly.
- Only the fixer has both the findings and the working tree in front of it, which is already why it dedups overlapping findings itself.
- The fixer is also the interested party: it is the role that would have to do the work. Asking it whether the work is worth doing is asking the wrong party — unless its answer is on the record and its consequences are not its to set.
- relay's shape is one **role** per real job. A doubt about a role's judgement is not by itself a reason for another role.
- No data existed on how often a fixer declines, or whether it is ever right to, because the one signal was thrown away.

## Considered Options

- **Option A** — Keep findings advisory. Carry the axis for reporting only; the fixer decides and nothing checks it.
- **Option B** — Make spec findings binding: the fixer answers per finding, and the **harness** blocks the pass over a binding finding nobody addressed.
- **Option C** — A triage **leg** between the review and the fix, deciding fix-or-skip per finding, with the fixer only executing.
- **Option D** — Push the triage upstream into the reviewer: it reports only findings it stands behind, and the fixer acts on all of them.

## Decision Outcome

Chosen option: **Option B**, with the two decisions it contains split between two roles.

- `Finding` becomes a discriminated union on `source`. A review finding carries an **axis**; the gate's carries none, because a gate verdict is neither of the review's questions.
- `isBinding` in `src/crew/contract.ts` is the one definition of binding, so the prompt, the block and the report cannot drift on what it means.
- The reviewer reports `{ standards, spec }` — two keyed arrays mirroring the skill's own two sections, because transcription is where a model drifts least. A problem both sections name goes under `spec`: the stricter axis wins, or binding leaks through a coin flip.
- The fixer answers **one verdict per finding**, keyed by ids relay stamps when it serialises the findings into the prompt. An id it invented, answered twice, or never answered is a `RoleError`.
- The ids live at the fix leg, not on `Finding`. A finding's identity is what one prompt and one answer agree to call it, not a fact about the finding.
- The harness owns the consequence: a binding finding nobody addressed is a `mid-block`, and it blocks **at the leg it was declined on** — mid-way through the ticket loop if that is where it happened.
- Every fixer leg writes its verdicts to its own record file, and every unaddressed finding reaches the handover.

The gate needs no rule of its own. A gate finding the fixer declines leaves the gate red, and the existing two-attempt cap blocks the pass by itself.

Option C was refused rather than deferred: it buys disinterest and pays a role for it, and it would judge the cost of a change without ever touching the tree.
Option D puts the judgement in the leg least equipped for it — a read-only reviewer that has never tried the change.
Option A was the state being fixed.

### Consequences

- Good: a fixer can decline to act on a finding, but not to account for it. `nothing-to-fix` stops being a veto and becomes a report.
- Good: the `console.log` that swallowed the only signal is gone. Every verdict is on disk, per leg, per [ADR-0012](0012-a-legs-facts-stay-next-to-the-leg.md).
- Good: a green pass now names how many findings it overrode, so a standards call nobody agreed to is visible without reading the records.
- Bad: a declined spec finding on ticket 1 of 3 ends the pass with tickets 2 and 3 unimplemented. Accepted deliberately: the alternative spends two implementer legs, a review and up to three gate runs building on a change already known not to do what was asked, and under `merge` **landing** walks it to the lander's door before stopping.
- Bad: a fixer that writes a plausible reason still stops the pass, so a wrong decline costs a human's attention. That is the trade: relay would rather waste a look than land the wrong branch.
- Bad: binding covers the fixer saying *no*. It does not cover the fixer saying *yes* and being wrong — see [ADR-0022](0022-a-fix-is-verified-once.md).

### Confirmation

`isBinding` has one definition and the harness is its only caller for the blocking decision; `git grep -n "isBinding" src/` shows both.
`tests/pass/harness-binding.test.ts` covers a declined spec finding at ticket scope and at branch scope, and a declined standards finding that lands.
`tests/crew/roles/fixer.test.ts` covers an unanswered id, an invented id and a doubled id, and asserts the old one-verdict-per-leg answer is refused.

## Pros and Cons of the Options

### Option A — keep findings advisory

- Good, because it is free and changes no contract.
- Bad, because "the reviews check whether we built what was asked" is then not true: nothing enforces it, and the only role that could is the one with an interest in not doing so.
- Bad, because it leaves the decline invisible, which is the concrete bug rather than a theoretical one.

### Option C — a triage leg

- Good, because the party deciding whether a fix is worth making would not be the party making it.
- Bad, because it costs up to three extra legs per pass and a fourth review-shaped role.
- Bad, because it would judge the cost of a change read-only, without the tree.

### Option D — the reviewer triages upstream

- Good, because it needs no per-finding verdict and no new role.
- Good, because the reviewer already does a weak version of it, dropping nits and theoretical-only findings.
- Bad, because the reviewer is read-only and has never attempted the change, so its cost estimates are guesses.
- Bad, because it hides the decision in prose rather than recording it as a verdict.

## More Information

- Provenance: the grilling of 2026-07-29 on relay's review legs.
- Related: [ADR-0022](0022-a-fix-is-verified-once.md) — the other half, on whether a fix is read by anyone.
- Related: [ADR-0012](0012-a-legs-facts-stay-next-to-the-leg.md) — why the fixer's verdicts are its own file and not an annotation on the review's.
- Related: [ADR-0020](0020-relay-ships-no-skills-of-its-own.md) — the review criteria themselves live in an installed plugin; relay owns the scope, the axis and the consequence.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
