# 0036. A leg that fails to answer blocks the pass, and never on quality

- **Status:** accepted
- **Date:** 2026-08-03
- **Amends:** [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md), [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)

## Context and Problem Statement

A **leg** whose tagged block is missing, is not JSON, or does not fit its schema raises a `RoleError` after the one retry [ADR-0033](0033-a-protocol-slip-gets-one-retry.md) gives it.
Nothing between that throw and the top of the **pass** told it apart from any other failure, so three things followed that nobody decided.

**It was reported as a crash.**
The pass-level `catch` treated every error alike: it recorded the pass end as `crashed` and posted the crash comment, which tells the human relay crashed and hands them a cleanup script.
Meanwhile the CLI maps `RoleError` to the **blocked** exit code.
The exit code said blocked and the comment said crashed, about one event.

**The handover never ran.**
`runHarness` reaches the **handover** only via an **outcome**; a throw unwinds past it.
The handover is the only thing that removes `agent-in-progress` and adds `agent-blocked`, and the only thing that pushes the **pass branch**.
So the **work item** and every **ticket** stayed held, nothing marked them as needing a human, and under `merge` **landing** the committed work sat in a **worktree** that was then disposed of.

**It could stop the pass on an axis that cannot stop one.**
[ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md) decided `quality` is not **binding**: a declined quality **finding** is reported and the pass lands green, and the prompt says in as many words that nothing in that stage can block.
A **quality review** or its **fixer** that failed to answer blocked it anyway.
This is what `rehearsal/runs/single-spec-merge-2026-08-01T20-12-20.txt` died on: an otherwise green `merge` pass ended at exit 1 with its work only on its own branch.

[ADR-0034](0034-the-quality-review-is-told-what-the-pass-already-settled.md) made the contradiction that provoked that run rarer, and added a case — a quality review may now overrule a **settled finding** — on which a fixer can still find itself with nothing it can act on.
[ADR-0035](0035-a-pass-records-its-own-facts.md)'s **archive** made the failure legible.
Neither changed what it costs.

The question this ADR settles is what a leg that fails to answer costs the pass, and what it costs on an axis that is not allowed to stop one.

## Decision Drivers

- A pass has one ending, and the exit code, the tracker comment and the **pass record** have to agree on which it was.
- A leg that failed to answer is a failure relay understands. It knows which leg, it has the leg's own sentence, and it holds the tickets committed, the findings left and the **gate verdict** so far — which is more than a crash has, and enough to hand over.
- The hold is the thing that matters most. A pass that leaves `agent-in-progress` on an item and its tickets, with no label and no comment saying why, costs a human more than a wrong word in a report.
- An advisory axis that can end a pass is not advisory. Whatever ADR-0027 decided about findings has to hold for the legs that produce them, or the decision only covers the polite failure mode.
- A leg that fails to answer is a *weaker* signal than a fixer that declines with a reason, not a stronger one. It must not buy an outcome a reasoned decline cannot.
- A genuine crash must keep everything it has. The cleanup script exists because nothing lifted the hold, and that is still true of a sandbox that will not open.

## Considered Options

For what a role failure costs the pass:

- **Option A** — A `RoleError` from the pass's legs becomes a `mid-block` **outcome** and takes the ordinary blocked path.
- **Option B** — Leave it a crash, and make the crash path run the handover too.
- **Option C** — Leave it. A leg that cannot answer is a genuine defect and a human should look.

For what it costs on the quality stage:

- **Option D** — The quality stage degrades: a failed review is a stage that produced nothing, a failed fixer leaves its findings unaddressed, and the pass carries on to the **green gate**.
- **Option E** — Retry the leg once more, then degrade.
- **Option F** — The general rule: a `RoleError` from any stage that cannot block does not block.

## Decision Outcome

Chosen options: **Option A** and **Option D**. Two rules.

### A role error is a blocked pass, not a crash

A `RoleError` raised anywhere in the pass's legs becomes a `mid-block` outcome carrying the error's own sentence as its reason, along with whatever the pass had accumulated by then.
It then takes the ordinary blocked path: the handover runs, the labels are swapped, the branch is pushed, the pass records its end as `handed-over`, and the exit code stays **blocked**.

- The conversion sits in the function that runs the legs, around the topology and inside the handover call. That is the one place holding the pass's partial progress.
- The pass's progress is written as each leg answers rather than assembled from what each stage returned. A stage that a failing leg cut short returns nothing, so a stage that only reported its tickets and findings on the way out took them with it — and the tickets a blocked pass committed are exactly what its handover has to label and report.
- The **crash** path keeps everything that is genuinely a crash: a sandbox that will not open, a `git` failure, an unexpected throw. It keeps its comment, its cleanup script and its `crashed` record arm.
- The **handover leg is deliberately outside this**. A handover that fails to answer is still a crash: it is the leg that would have reported the block, there is nothing to hand the work to, and the hold it would have lifted is exactly what the crash comment tells the human to clear.
- The **gate resolver** is outside it too, for a narrower reason. It supplies the `ResolvedGate` that every `GateVerdict` carries, including `not-gated`, so a pass that never got one has no gate verdict to state and nothing to report a block with.
- `runRole` and its retry are **unchanged**. ADR-0033's one retry still runs, because it recovers a fixer that did the work and narrated it instead of tagging it — degrading immediately would report as unaddressed a fix already on the branch. The degrade happens above `runRole`, which needs no knowledge of its caller.

This adopts what ADR-0035 refused as its **Option D**, "make a thrown `RoleError` an outcome", and the difference is the motive.
ADR-0035 was asked for a durable **record** of what a pass did, and refused this as an expensive way to obtain one — correctly, because a `writeFile` obtained it and the pass record now does.
What is adopted here is the same mechanism for a different purpose: to give the pass a correct *ending*.
A record can describe a pass that ended wrongly; it cannot swap the labels, push the branch or lift the hold.
ADR-0035's second objection — that a leg which broke its output protocol cannot be relied on to have left the branch in a state the remaining legs can run over — is met by not running them: this ends the pass at the leg that failed, exactly as before, and changes only how that ending is published.
The `crashed` arm of `PassEnd` now covers a strictly narrower set of endings than ADR-0035 wrote it for, and its meaning is the sharper for it: relay could not explain what happened.

### The quality stage cannot stop a pass, by any means

Not by a finding, which it cannot raise bindingly, and not by a leg that fails to answer:

- A **quality reviewer** that fails to answer means the stage produced nothing. The stage is skipped and the pass continues to the gate. There are no findings, so nothing is unaddressed.
- A **quality fixer** that fails to answer means the findings it was handed were never decided. They become **unaddressed findings**, each naming that the fixer failed to answer, and the pass continues to the gate.

A pass whose quality stage degraded and which is then green lands and closes its issues, exiting zero.
That is the point: the axis is advisory, and a leg that fails to answer must not buy an ending that a fixer declining with a reason cannot.

- The quality stage stops going through the shared review-then-fix helper and states its own review → fix sequence with the degrade between them. That helper keeps its two remaining callers, the **ticket** and branch scopes, which have not changed. It is not parameterised: the two stages have genuinely diverged, and a flag threading one caller's concern through the other's path is the shape this repo avoids.
- `isBinding` is **unchanged** and stays a predicate on a finding. There is no per-leg or per-stage binding predicate; the rule written here is about the quality stage specifically.
- Both degrades are named on the console, because the handover cannot see them.

Two hazards, both accepted, both stated so they are not re-litigated:

- A quality fixer may have committed a partial fix before failing, and its branch rule is never judged because the throw precedes it. The **green gate** runs next and is that fix's only verifier by ADR-0027's design, so a broken partial fix is caught there like any other. What survives is a structurally incomplete change that is green — the same thing the pass lands when a fixer declines a quality finding.
- A skipped quality review is invisible in the handover comment: a pass that never ran the review reads like one that found nothing. Accepted. The failure is in the **leg record** and the archive, and the console names it. A new handover input for "a leg failed to answer" was considered and rejected as more surface than the case is worth.

Option B was refused: the crash path exists to say relay could not explain itself, and running a leg from it makes it a second, quieter version of the blocked path.
Option C is the status quo and defensible — a leg that cannot answer *is* a defect — but it charges a whole pass, and the hold left behind, for a defect on an axis that is not allowed to charge anything.
Option E was refused as more expense for a leg that emitted nothing once and may well do it again, on top of a retry it already had.
Option F was refused as the widest fix and the one most likely to hide a real failure: the ticket and branch reviews both read `spec`, the gate is objective, and the handover must report — so the general rule would apply to exactly zero legs beyond the quality stage while adding a way to swallow a failure relay does want to stop for.

### Consequences

- Good: one ending per pass. The exit code, the tracker comment, the labels and the pass record now agree about a leg that failed to answer.
- Good: the hold is lifted and the branch is pushed on the path where the work is most likely to be salvageable — the pass ran, it committed tickets, and one leg mumbled.
- Good: `quality` is advisory in fact and not only in its findings, which is what ADR-0027 decided.
- Good: `crashed` means something narrower and therefore sharper.
- Bad: the harness cannot distinguish a quality leg that *failed* from one that *declined*, so a broken leg can read as a routine override in the handover's report. The leg record, the console and the archive are where the difference lives.
- Bad: a pass now hands over on a state one of its legs did not describe. The handover reports the leg's own sentence, which is a protocol complaint rather than a description of the work, and a human reading only the tracker comment gets a thinner story than a crash comment gave them.
- Bad: `PassProgress` is now mutated by the stages rather than returned by them. The stages are smaller for it, but the write is no longer visible at the call site.

### Confirmation

`tests/pass/harness-role-error.test.ts` asserts that a `RoleError` from a leg becomes a `mid-block` carrying the error's sentence, that the handover is reached and told it, that the pass still exits blocked, that everything the pass got through travels with it — including the red verdict a gate loop reached before its fixer failed to answer — that a non-`RoleError` throw is still a crash, and that a `RoleError` from the handover itself is too.
`tests/pass/harness-quality.test.ts` asserts that a failed quality reviewer leaves the pass running to the gate with nothing unaddressed, that a failed quality fixer leaves every finding it was handed unaddressed under the new reason, that such a pass lands and exits zero, and that a non-`RoleError` throw from that stage still ends the pass.
`tests/pass/pass.test.ts` asserts that a leg that failed to answer records `handed-over` and posts no crash comment, and that a handover that failed to answer records `crashed` and does.

## Pros and Cons of the Options

### Option B — leave it a crash, and run the handover from the crash path

- Good, because the labels get swapped and the branch gets pushed without touching the harness's control flow.
- Bad, because the crash path would then publish a block while its comment says relay crashed, which is the disagreement this ADR exists to remove.
- Bad, because a handover run from a `catch` has no outcome to report, so it would have to be handed one — which is Option A with the conversion in the wrong place.

### Option C — leave it

- Good, because a leg that cannot answer is a real defect and a human looking at it is the right outcome.
- Good, because it is the least code: none.
- Bad, because the cost is a whole pass plus a hold nothing lifted, and on the quality stage that cost is charged over an axis ADR-0027 said could not charge it.
- Bad, because the exit code already says blocked, so the status quo is not "we decided to crash" but "two paths disagree".

### Option E — retry, then degrade

- Good, because a second attempt sometimes recovers a leg that mumbled once.
- Bad, because ADR-0033 already spent that retry, and a leg that emitted nothing twice is unlikely to emit something the third time.
- Bad, because it costs a whole leg's runtime on the pass's least binding stage.

### Option F — a role error from any non-binding stage does not block

- Good, because it is one rule rather than a rule about one stage.
- Bad, because no stage beyond the quality stage qualifies: the ticket and branch reviews read `spec`, the gate is objective and the handover must report.
- Bad, because it invites a future stage to become non-blocking by accident, which is the way a real failure gets swallowed.

## More Information

- Provenance: grilled 2026-08-03. Split from the defect [ADR-0034](0034-the-quality-review-is-told-what-the-pass-already-settled.md) fixed, which marked this path out of scope.
- Amends [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md): what a crashed pass leaves for a human is unchanged, but a leg that fails to answer is no longer one of the things that leaves it.
- Amends [ADR-0027](0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md): the quality stage cannot stop a pass by a leg either, not only by a finding.
- Related: [ADR-0033](0033-a-protocol-slip-gets-one-retry.md) — the retry this decision leaves untouched, and the leg record that holds the slip.
- Related: [ADR-0035](0035-a-pass-records-its-own-facts.md) — the pass record, and the Option D this adopts.
- Related: [ADR-0021](0021-spec-findings-are-binding.md) — why `spec` binds and `quality` does not.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md) — **Failed to answer**, which this ADR coins, and **Unaddressed finding**, **Blocked**, **Outcome**, **Pass record**.
