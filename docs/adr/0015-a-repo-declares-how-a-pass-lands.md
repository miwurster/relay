# 0015. A repo declares how a pass lands

- **Status:** accepted
- **Date:** 2026-07-28

## Context and Problem Statement

relay's **handover** publishes a pull request and is explicitly told never to close the **work item** — "a human does that themselves, after merging".
That makes the human's last mile fixed: review the pull request, merge it, and let GitHub's `Closes` keywords close the **tickets**.

For an operator who reviews the branch as it lands rather than in a pull request, that mile is pure ceremony.
The pull request exists to be merged by the same person who would otherwise have merged the branch, and the tickets stay open until GitHub notices.
sandcastle, the framework relay is built on, never opens one: its merge agent merges each branch into the host's current branch and closes each issue with `gh issue close`.

So relay has to decide whether "brings work to a reviewable state and stops" is relay's identity or one of two shapes a repo picks, and — if it is a choice — what the other shape closes and when.

## Decision Drivers

- A pass already holds a `GH_TOKEN` with write access to the repo ([ADR-0005](0005-secrets-travel-with-the-machine.md)), so the mode is not a new class of trust, only a new class of write.
- A mode that decides whether the repo's own base branch moves is not a per-invocation whim.
- `relay.config.ts` is a `strictObject`, so a missing key fails as loudly as an unknown one — a migration an operator cannot skip.
- A tracker that says closed while the work exists on one laptop is worse than a tracker that says nothing.

## Considered Options

- **Option A** — one config key, `landing`, with `pull-request` and `merge` as its two values, and no default.
- **Option B** — a boolean, `merge: false` by default.
- **Option C** — keep pull requests as relay's only shape and reject the request.

## Decision Outcome

Chosen option: **Option A**.

`landing` is a required enum in `relay.config.ts`.
`init` writes `landing: "merge"`, so a fresh repo states the mode in the file relay generated for it.
Four sub-decisions carry the weight.

**Required, with no default.**
A default of `merge` would flip every already-configured repo to moving its base branch on the next upgrade, with nothing in its config saying so.
A default of `pull-request` would mean writing the key in every repo forever.
So the key is required: an existing config fails with `landing: Invalid input` until edited, which is a one-line fix and never a silent change of behaviour.

**Merge landing closes what it landed, and only that.**
Handover closes every committed ticket, then re-reads the work item's sub-issues and closes the work item only when none of them are still open.
That keeps the reason relay never let a closing keyword reach a parent — closing it out from under a remaining child — while giving the operator the automatic close they asked for.
The work item ends with `agent-in-progress` removed and no label added: `agent-in-review` would be false, because nothing is awaiting review, and a closed issue already carries the meaning.

**Closing follows publication, never precedes it.**
The base branch is pushed before anything is closed, and a rejected push ends the pass `mid-block` with nothing closed.
A closed ticket therefore means merged *and* reachable by somebody other than the operator who ran the pass.
A repo whose base branch requires a pull request cannot use merge landing at all, which is a **doctor** check rather than a discovery made after the gate, the rebase and the re-gate have been paid for.

**A merge-landing repo never opens a pull request, including when blocked.**
A blocked pass pushes its **pass branch** and opens nothing, so the committed work is reachable from anywhere while the base branch stays untouched.
The alternative — falling back to a draft pull request on failure — was rejected because it makes `landing` mean two things and forces every prompt to explain both.

### Consequences

- Good: the human's last mile disappears where it was ceremony, and relay's own commits are what closed the tickets.
- Good: which shape a repo runs is a sentence in its committed config, not an inference from what relay did last time.
- Bad: `README.md`'s promise of "one item, brought to a reviewable state, and a stop" now holds only under `pull-request` landing, so relay has two identities to document rather than one.
- Bad: under merge landing nothing between the green gate and the operator's `main` is a human, so the reviewer legs are the only review that work gets.
- Bad: every existing repo's config fails to load until `landing` is added.

### Confirmation

A repo with no `landing` key fails to load with `landing: Invalid input`.
A `merge` repo's successful pass leaves the base branch pushed, its tickets closed, and no pull request.
A `merge` repo whose base branch carries a pull-request ruleset fails `doctor` before a pass runs.

## Pros and Cons of the Options

### Option B — a boolean

- Good, because it is the smallest diff and coins no vocabulary.
- Bad, because it names one mode after its mechanism and the other after nothing, so pull-request landing becomes "not merge".
- Bad, because a boolean cannot grow a third landing without contradicting its own name.

### Option C — pull requests only

- Good, because relay keeps one shape, one set of prompts, and its stated identity.
- Bad, because it leaves the operator merging and closing by hand on every pass, which is the cost that prompted the question.

## More Information

- Provenance: grilling of 2026-07-28.
- Related: [ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md) — the branch merge landing lands on.
- Related: [ADR-0017](0017-the-lander-rebases-and-the-host-only-fast-forwards.md) — how it gets there.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) — closing is `gh issue close`, with no tracker abstraction between.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
