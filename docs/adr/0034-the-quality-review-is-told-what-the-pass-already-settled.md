# 0034. The quality review is told what the pass already settled

- **Status:** accepted
- **Date:** 2026-08-03
- **Amends:** [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)

## Context and Problem Statement

[ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md) made the **quality review** its own **review scope**: the last review of a **pass**, judging the branch against a vendored rubric once the `spec` question is settled.

Its scope carries the **work item** and nothing else, so the leg reads the branch diff and the rubric with no knowledge of what any earlier review of the same pass ordered on that same branch minutes before.

A rehearsal loop of 18 passes produced exactly one block, and relay generated it itself (`rehearsal/runs/single-spec-merge-2026-08-01T20-12-20.txt`):

1. The **branch review** raised a `standards` **finding**: the trim-then-empty-check shape duplicates `requireTitle`, so extract a shared trim helper.
2. The branch **fixer** extracted it. The **re-review** passed.
3. The quality review then read the same branch and raised a finding on the helper that had just been created: `trim` is an identity wrapper adding indirection without expressing a rule, so delete it and call `.trim()` directly.
4. The quality fixer, handed two instructions from the same pass pointing opposite ways, emitted nothing relay could parse. The pass blocked.

Both reviews are defensible in isolation. Neither is wrong about the code in front of it. The quality review simply had no way to know it was overruling anything, and the fixer had no way to satisfy both.

The question this ADR settles is what the last review of a pass is told about the earlier ones.

## Decision Drivers

- A review that reads a branch a fixer just changed is reading a decision, not an accident. A leg that cannot tell those apart will treat both as code that arrived that way.
- The quality review must keep the right to disagree. The rubric is most useful on recently restructured code, and an earlier call can be wrong.
- The fixer is the leg that pays: it is cold, it sees only what it was handed, and two contradicting instructions leave it nothing to do that is right.
- Whatever travels must be small. Every leg is a cold agent session, so the harness can pass only the values in `contract.ts`.
- A finding a fixer *declined* changed no code, so there is nothing on the branch to reverse.

## Considered Options

- **Option A** — Hand the quality scope the findings a fixer already acted on this pass, and let it overrule one only by saying so.
- **Option B** — Drop any quality finding whose target is code a fixer touched this pass.
- **Option C** — Leave it, and make the quality fixer resolve the contradiction itself.

## Decision Outcome

Chosen option: **Option A**.

- `ReviewScope`'s quality arm gains `settled: readonly Finding[]` — every finding a fixer reported `fixed` earlier in this pass, from the per-ticket reviews and from the branch review both. The term is **settled finding**, and it is in [`CONTEXT.md`](../../CONTEXT.md).
- The **harness**'s stage results carry what their fixer fixed, which is how the two sources reach the quality scope. The per-ticket loop kept only what was declined; the branch stage used its fixed list locally for the re-review without returning it.
- The list travels into the prompt stripped to axis and summary, the same shape and for the same reason the re-review's claims already use ([ADR-0032](0032-the-re-review-verifies-the-fix-it-was-handed.md)): the sentence the fixer read is what makes a remedy legible.
- The prompt states that those remedies are on the branch as decisions rather than suggestions, and that a finding undoing one must name the settled finding it overrules and why that earlier call was wrong.
- The list is always present. A pass that fixed nothing carries it empty, which reads as "nobody has corrected this branch before you" — distinct from not being told.
- The answer schema is unchanged: one `quality` array, no key that is not an axis. A scope's keys are the axes it was asked for, so there is no structured reversal marker; the finding sentence carries the overrule.
- Findings a fixer declined do not travel. No code changed for them, and listing them would wrongly discourage the review from raising a real structural problem.

### Consequences

- Good: the contradiction that produced the block is visible to the leg that would otherwise create it, in the words the earlier fixer acted on.
- Good: the quality review keeps its judgement. It may still reverse a landed fix — it just has to say what it is reversing.
- Good: a human reading a quality finding that overrules an earlier one gets the reasoning, which is the disagreement they most need to arbitrate.
- Bad: the risk is over-deference. A quality review told what is settled may stay quiet about genuine structural problems in exactly the recently-fixed code the rubric is most useful on. No test can see this; the rehearsal loop can.
- Bad: it makes the deadlock rarer, not impossible. A leg that emits no parseable block still blocks the pass, even on a non-binding axis — filed separately, and not fixed here.

Option B was refused: it silences the review on exactly the code most likely to have just been made worse, and identifying "that code" means guessing at file and line from a finding's sentence. Option C was refused because the fixer is the leg with the least context in the pass, and the rehearsal shows what it does with a contradiction.

### Confirmation

`tests/pass/harness-quality.test.ts` asserts the quality scope carries what a fixer fixed at ticket scope and at branch scope alike, over a multi-ticket plan; that a pass which fixed nothing carries the list empty; and that a declined finding does not travel.
`tests/crew/roles/reviewer.test.ts` asserts the settled list reaches the quality prompt's arguments, stripped to axis and summary, and that the prompt states the overrule rule.
Prompt parity holds `quality-review.md`'s placeholders to the arguments the role passes it.

## Pros and Cons of the Options

### Option B — drop a quality finding that targets code a fixer touched

- Good, because no contradiction can reach a fixer at all.
- Bad, because the code a fixer just wrote is the least-reviewed code on the branch, and this is the one leg left that reads it.
- Bad, because "the code a fixer touched" is a guess: a finding names a file and a line in prose, and matching that against a diff is a heuristic that will silence the wrong findings.

### Option C — leave it to the quality fixer

- Good, because nothing changes.
- Bad, because the fixer is cold and sees only the findings it was handed, so it cannot know which instruction is older.
- Bad, because the rehearsal already ran this option: the leg answered with something relay could not parse, and the pass blocked.

## More Information

- Provenance: the 3-round rehearsal loop of 2026-08-01, `rehearsal/runs/loop-2026-08-01T15-49-41.log`; the digest is `rehearsal/runs/single-spec-merge-2026-08-01T20-12-20.txt`.
- Amends: [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md) — the quality review stays its own scope, non-binding, unbounded by the diff. Only what it is told changes.
- Related: [ADR-0032](0032-the-re-review-verifies-the-fix-it-was-handed.md) — the shape a fixer's claims travel in.
- Related: [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md) — why the `standards` axis is read at ticket scope on a multi-ticket plan and at branch scope otherwise, which is why both sources contribute.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
