# 0032. The re-review verifies the fix it was handed

- **Status:** accepted
- **Date:** 2026-07-31
- **Amends:** [ADR-0022](0022-a-fix-is-verified-once.md)

## Context and Problem Statement

[ADR-0022](0022-a-fix-is-verified-once.md) chose one re-review after the branch review's fixer leg, and specified it as "the same **role**, the same prompt, the same model and the same diff range", differing only in its name.

Two rehearsals ran that shape end to end, and both blocked in the same place:

| run | branch review | fixer | re-review |
|-----|---------------|-------|-----------|
| #42, `merge` | 2 findings (1 `spec`, 1 `standards`) | both **fixed** | 2 new `spec` findings |
| #43, `pull-request` | 2 findings (1 `spec`, 1 `standards`) | both **fixed** | 3 new findings (2 `spec`, 1 `standards`) |

Every one of the re-review's findings pointed at lines the fixer had just written.

The mechanism is not a flake, and it is not a bad reviewer. A branch-scope `spec` fix is usually "add the missing test", so the fixer emits code no review has ever read. The re-review then runs the branch review's prompt, which invokes `mattpocock-skills:code-review` over `{{BASE}}...HEAD` — a full read of a diff that now contains that new code. A full read of unread code finds something; on test code it finds `spec`-shaped things ("this asserts two behaviours", "that assertion is too weak", "this title does not say what it asserts"). `spec` is **binding**, and by ADR-0022 the re-review's findings reach no fixer, so `blockFor` stops the pass.

The result is a pass that cannot converge: whatever the fixer writes to satisfy the re-review is itself code the re-review has not read. The block does not mean the fix was wrong. It means a fix happened.

The question this ADR settles is what the re-review is asked, given that it is the last leg that can raise a binding finding.

## Decision Drivers

- ADR-0022's own title is "a fix is verified once". Verification is the job it named; a fresh review is what it built.
- A finding nobody can act on is only worth raising if it is worth stopping the pass for. "The fix did not do what was asked" is worth that. "The test the fixer wrote could assert more" is not.
- The failure is systematic, not probabilistic: any branch fix that touches code makes new code, so the block rate approaches 1 on exactly the passes where a human already asked for changes.
- Single-ticket passes are hit hardest. [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md) gives them both axes at branch scope, so they produce more findings, so the fixer writes more, so the re-review reads more it has never seen.
- Whatever runs here is the pass's most expensive role. A cheaper question is also a cheaper leg.

## Considered Options

- **Option A** — Keep the full re-review, and make its findings non-binding.
- **Option B** — Hand the re-review the findings the fixer said it fixed, and ask only whether the branch now satisfies them.
- **Option C** — Keep the full re-review, and give it a second fixer leg.

## Decision Outcome

Chosen option: **Option B**.

- `ReviewScope`'s branch arm carries `verifying: readonly Finding[] | undefined` in place of `rereview: boolean`. Absent on the first run; on the second it is `FixReport.fixed`, the findings the fixer claimed. Presence is what makes a run the re-review, so the two facts cannot disagree.
- The re-review reads its own prompt, `rereview.md`, which is handed those findings stripped to their axis and their line — exactly what the fixer was handed. It is told not to use the code-review skill, and not to review the branch any other way.
- It reports a finding per handed finding the branch does not now satisfy, on that finding's own axis, and nothing else. A fixer whose every claim holds is no findings.
- It answers in the same axis shape the review it verifies used, so nothing downstream changes: the same schema, the same `Finding`, the same `blockFor`.
- Everything ADR-0022 decided about the leg stands: one run, never a loop, only after a fix that changed something, report-only, and `spec` blocks.

A finding the re-review raises now means one thing — the fixer said it fixed this and it did not. That is a sentence worth stopping a pass on, which is what ADR-0021's binding rule was for.

Option A was refused because it would make the re-review's every finding advisory, including the one failure ADR-0022 exists to catch. Option C was refused again, on ADR-0022's own reasoning: the last round of any loop is unverified too, and a review that loops reads as relay deciding when it is done.

### Consequences

- Good: the re-review can be satisfied. A correct fix produces no findings, so a pass whose fixer did its job lands.
- Good: the leg is much cheaper. It reads a short list against a diff instead of running a full code review.
- Good: a fixer that reports `fixed` for a change it did not make is still caught, and still blocks — which was the point.
- Bad: a `standards` problem the fixer's own commit introduced is no longer raised at all. ADR-0022 accepted reporting-and-landing it; this drops the report. Accepted: nobody acts on it either way, and it arrived beside binding findings that stopped the pass, which is worse than not hearing about it.
- Bad: a `spec` problem in the fixer's new code that no handed finding covers now lands. Accepted, and it is the same trade ADR-0022 made one round earlier: the fixer's commit is the last code written, and the last code written is always the least reviewed.
- Bad: the re-review's judgement now depends on the fixer's own `fixed` verdicts. A fixer that declined everything already skips the leg, so the case this adds is a fixer that claims a fix it did not make — which is exactly what the leg reads the code to catch.

### Confirmation

`tests/pass/harness-rereview.test.ts` asserts the re-review is handed exactly the findings the fixer reported `fixed`, and none it declined — alongside ADR-0022's own assertions, which still hold.
`tests/crew/roles/reviewer.test.ts` asserts the re-review runs `rereview.md` rather than `review.md`, that its prompt carries the fixer's claims with their axes, and that it answers in the axis shape of the review it verifies.
Prompt parity holds `rereview.md`'s placeholders to the arguments the role passes it.

## Pros and Cons of the Options

### Option A — full re-review, findings non-binding

- Good, because it is a one-line change at `blockFor`.
- Good, because a standards problem in the fixer's commit is still reported.
- Bad, because it silences the finding the leg exists to raise. A fix that addressed the wrong half of the item would be reported and landed.
- Bad, because it keeps paying for a full review whose findings are advisory.

### Option C — full re-review plus a second fixer

- Good, because the re-review's findings would reach somebody.
- Bad, because the second fixer's commit is then unread, so the loop it opens has no natural end — ADR-0022 already refused this.
- Bad, because it treats "the reviewer found new things in new code" as work to be done rather than as the runaway it is.

## More Information

- Provenance: the rehearsal runs of 2026-07-31 on `miwurster/relay-rehearsal`, work items #42 and #43. Both digests are under `rehearsal/runs/`.
- Amends: [ADR-0022](0022-a-fix-is-verified-once.md) — one re-review, report-only, never a loop. Only the question it asks changes.
- Related: [ADR-0021](0021-spec-findings-are-binding.md) — what an unaddressed binding finding costs.
- Related: [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md) — why a single-ticket pass reached this first.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
