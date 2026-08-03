# 0027. the branch review splits into a spec review and a quality review

- **Status:** accepted, spec-only half amended by [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md), quality scope amended by [ADR-0034](0034-the-quality-review-is-told-what-the-pass-already-settled.md), quality's non-binding rule extended to its legs by [ADR-0036](0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)
- **Date:** 2026-07-31

## Context and Problem Statement

[ADR-0020](0020-relay-ships-no-skills-of-its-own.md) collapsed relay's three review lenses into one **role** with one prompt, run once per **review scope**, invoking `mattpocock-skills:code-review` and translating its two-axis report into **findings**.

That skill's `standards` axis is a hunk-local question: does the diff break a rule this repo documents, and does it show one of a fixed list of Fowler smells.
It is not the question a human asks when they read a whole branch and wonder whether the implementation is worth keeping — whether a layer should have disappeared, whether logic landed in the module that already owns the concept, whether the change pushed a file past a size nobody wants to read.
Nothing in a **pass** asked that, so nothing in a pass answered it.

The public rubric that does ask it — Cursor's `thermo-nuclear-code-quality-review` — is a skill for an agent that reviews a pull request and approves or blocks it, distributed through a marketplace relay does not mount and does not want a second operator prerequisite for.

## Decision Drivers

- Whatever a public rubric already does well is not relay's to reimplement — the driver ADR-0020 was decided on.
- A **leg** should ask one question. Two questions in one prompt is how the collapsed lenses got confusing in the first place.
- A judgement about structure must not be able to stop a pass that does what the **work item** asked and is green.
- No second operator prerequisite, and no marketplace whose contents relay cannot see.

## Considered Options

- **Option A** — Leave it: one review, two axes, both scopes. Structural quality stays unasked.
- **Option B** — Mount `cursor-team-kit` as a second **skill plugin** and have a third review scope invoke it.
- **Option C** — Vendor the rubric into relay's resources, split the branch review in two, and give the second one a `quality` **axis** and a scope of its own.
- **Option D** — Fold the rubric's rules into relay's own review prompt, authored as relay's text.

## Decision Outcome

Chosen option: **Option C**.

The whole-branch review now asks the `spec` question alone — where a ticket review ran, which [ADR-0031](0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md) later qualified for the single-ticket **plan** that has none.
A new **quality review** follows it: one cold read-only **leg** over the same branch, judging it against the vendored rubric, reporting a `quality` finding per thing it wants restructured, and handing those to one fixer leg.

It is a third **review scope**, not a role of its own.
A review is the same leg every time — one read-only run over a diff, ending in a finding per thing it wants changed — and everything that differs between the three is already the scope's own: its prompt, its model, the axes it is asked for and the shape it answers in.
Giving the quality question a `Crew` member of its own would have bought one prompt per question at the price of a second copy of the review mechanism: its own role module, its own harness stage, its own findings-file naming.
`ReviewKind` names three reviews, so `ReviewScope` names three scopes.
The **ticket** scope is unchanged and still reads both `standards` and `spec` — it is the cheap per-ticket guard that keeps a bad ticket out of the ones after it, and the quality review is a once-per-pass read that cannot serve that purpose.

The topology becomes: branch spec review → fix → its one **re-review** → quality review → fix → the gate loop.
The quality review runs whenever the branch stage did not block, including after a spec fix: a branch that has just been patched is the most likely to be structurally messy, so skipping the read exactly there would be backwards.
Its fix is verified by nothing but the gate — a fix is verified once ([ADR-0022](0022-a-fix-is-verified-once.md)), and the re-review exists only because `spec` is **binding** and the gate is objective.

`quality` is **not** binding.
`isBinding` still answers true for `spec` alone, so a declined quality finding is reported to the **handover** and the pass lands green.

### Vendoring, against ADR-0020

ADR-0020 said relay ships no skill of its own in any form.
That is narrowed here to: **relay authors no skill.**
The rubric lives at `src/resources/skills/thermo-nuclear-code-quality-review.md`, copied verbatim under its MIT licence, with a provenance header naming its source, its commit and that licence.
Its body is never edited; an upstream change is taken by re-vendoring.

It is a prompt resource, not a mounted skill: nothing relay ships is visible from inside the **sandbox**, whose worktree is the target repo's, so the prompt carries the rubric in as an argument.
`mattpocock-skills@claude-plugins-official` therefore remains the one skill plugin a pass mounts, and there is no new operator prerequisite, no `doctor` check and no version pair.

Everything that adapts the rubric to relay lives in `quality-review.md` and never in the vendored file: that the leg reports rather than approves, that the rubric's conversational phrasings are not the wording relay wants, and that the target repo's own `AGENTS.md` wins wherever the two disagree.

### Consequences

- Good: the question a human actually asks of a branch is now asked by a leg, on a rubric written for it.
- Good: each review prompt asks one question, so neither axis can mask the other inside one leg's context.
- Good: each scope answers in a schema of its own, holding a key per axis it was asked for and refusing any other, so an empty array always means "found nothing".
- Good: the rubric is one file with a provenance header — diffable against upstream, and obviously not relay's to tune.
- Good: no new plugin, marketplace, operator step or `doctor` check.
- Bad: a pass costs one more reviewer leg and, when it finds anything, one more fixer leg.
- Bad: the rubric invites restructuring outside the diff, so a quality fix can touch code the pass never wrote — a bigger diff for the human to read, on a branch they were reviewing for one work item.
- Bad: relay carries a copy of someone else's text and will not notice when upstream changes it.
- Bad: the answer shape a review owes now lives in the reviewer module rather than wholly in its prompt, because the prompt is shared and the shape is not.
- Bad: `Axis` has three values where two of them weigh the same, so `isBinding` reads as a rule about `spec` rather than a rule per axis.

## Pros and Cons of the Options

### Option A — leave it

- Good, because it costs nothing and the review stays one prompt.
- Bad, because nothing in a pass ever asks whether the implementation is worth keeping, which is most of what a human notices first.

### Option B — mount a second skill plugin

- Good, because relay copies nobody's text and an upstream fix arrives on its own.
- Good, because a human can invoke the same rubric by hand outside a pass.
- Bad, because it is a second operator install, a second `doctor` check and a second version that can disagree — the exact cost ADR-0020 deleted a marketplace to avoid.

### Option D — author the rules as relay's own prompt text

- Good, because there is one file and no provenance to track.
- Bad, because relay then maintains a maintainability rubric, which is the kind of ownership ADR-0020 decided against.
- Bad, because a rubric paraphrased into relay's voice is no longer diffable against the source it came from.

## More Information

- Narrows [ADR-0020](0020-relay-ships-no-skills-of-its-own.md): no skill relay **authors**, rather than no skill in any form.
- Related: [ADR-0021](0021-spec-findings-are-binding.md), whose rule is unchanged — `quality` joins `standards` on the non-binding side.
- Related: [ADR-0022](0022-a-fix-is-verified-once.md), which is why the quality fix gets no re-review.
- Related: [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md), whose mount-from-host rule still covers exactly one plugin.
- Rubric source: <https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review>, MIT, © 2026 Cursor.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
