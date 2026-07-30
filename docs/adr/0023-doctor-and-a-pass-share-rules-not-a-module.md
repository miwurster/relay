# 0023. doctor and a pass share rules, not a preflight module

- **Status:** accepted
- **Date:** 2026-07-30

## Context and Problem Statement

**Doctor** runs every setup check eagerly and reports all sixteen of them; a **pass** fails fast on the first thing that stops it.
The two overlap, because some of what doctor asks is what a pass refuses over.

An architecture review read that overlap as four duplications between `src/doctor/doctor.ts` and `src/pass/pass.ts`, and proposed one `preflight` module that both would run — doctor rendering each check as it resolves, the pass refusing on the first that failed.

Read against the code, three of those four are not duplications.
Image resolution already shares its implementation: `resolvableImage` calls `resolveSandboxImage`, and only the sentence naming the dockerfile differs.
The label vocabulary already shares `ghLabelNames` and `missingLabels` with **init**; only the record shape differs.
`gh` reachability already shares both probes, called in the same order by both callers; only each caller's purpose-specific tail differs, which is each one telling an operator what it wanted `gh` for.

One rule was genuinely duplicated: the dirty host worktree under `merge` **landing**, written as two independently-worded sentences, with no test able to see them disagree.

The question this ADR settles is whether doctor's checks and a pass's refusals become one module.

## Decision Drivers

- Doctor reports every check and a pass refuses on the first, so a module serving both would have to own severity — and severity is exactly where the two differ.
- A dirty worktree under `merge` is a **warning** in doctor and fatal in a pass, deliberately: doctor runs whenever an operator likes, and the worktree that decides anything is the one a pass finds at its own start.
- Doctor's sixteen checks are hand-wired rather than declared as a graph, on the same reasoning already recorded at `src/doctor/doctor.ts` — the graph would cost more in generics than the guards cost in lines.
- Some of a pass's refusals are scoped to a **work item**, and doctor has none to ask about: `refuseOnBranchCollision` asks about one item's **pass branch**.
- A `Check[]` is doctor's return type, not a pass's. A pass wants a refusal, and translating a `Check` back into a `ConfigError` at every call site buys nothing.
- `AGENTS.md`: no abstractions for single-use code, and no configurability nobody asked for.

## Considered Options

- **Option A** — One `preflight` module owning the rules, their order and their severity. Doctor renders each `Check`; the pass refuses on the first failed one; init reuses the `gh` and label parts.
- **Option B** — Share only the rules that genuinely drift, as small functions under `src/host/`. Each caller keeps its own severity and its own ordering.
- **Option C** — Keep both implementations and add a test asserting doctor warns exactly when a pass refuses.
- **Option D** — Give doctor an optional work item (`relay doctor 42`) so it can check every rule a pass does, then unify.

## Decision Outcome

Chosen option: **Option B**.

- `src/host/dirty-worktree.ts` holds `whyLandingRefusesWorktree`, which answers with the one sentence or with nothing. It gates on **landing** and reads the worktree itself, so there is one sentence and one rule.
- Severity stays with the caller. Doctor grades the answer a **warning**; the pass throws a `ConfigError` carrying it. Neither the rule nor `src/host/` knows doctor's report vocabulary.
- Ordering stays doctor's, hand-wired as it is today.
- `gh` reachability is left alone. Nothing observable can diverge, and sharing the tails would make each caller's message worse.
- The branch collision stays a pass-only refusal. The rule needs a **work item** to be about.

Three defects of the same shape — one question answered twice — are fixed alongside it, none of which needs a module either.

- The base branch is resolved once per doctor run. `GateProbe` carries it, so a detached `HEAD` reports one failed `landing` check and one skipped `gate` rather than the same sentence twice.
- The image doctor proved is handed to the probe. `openSandbox` takes an optional `image`, so a repo building from a **sandbox recipe** stops paying a second, cached build in one doctor run.
- `branchExists` moves to `src/host/git.ts` and takes a `GitRunner`, so the **gate probe** stops writing the same git argv by hand.

Option A was refused rather than deferred.
It has to decide severity to be useful to both callers, and the only two severities it could pick each contradict one caller: failing a dirty worktree contradicts doctor, warning on one contradicts the pass.
Option C pins two string literals to each other, which the type system does for free once the literal is one.
Option D is a new command surface, an argument and a set of item-scoped checks, to make one rule shareable.

### Consequences

- Good: the shared rule cannot drift. There is one sentence, so doctor cannot describe a refusal the pass does not make.
- Good: a detached `HEAD` stops producing two failures with one cause.
- Bad: doctor still asks `landing === "merge"` itself, to tell *skipped under `pull-request`* from *ok because clean*. Accepted: it is a narrowing check with no sentence, no severity and no git call behind it, so nothing an operator reads can drift with it.
- Bad: the rules that stay doctor-only stay unpinned to any pass behaviour, and `refuseOnBranchCollision` remains invisible to doctor. An operator can still pass doctor and have a pass refuse — on a rule doctor never claimed to check.
- Bad: doctor's test shape is untouched. Its fakes still answer positionally in doctor's internal call order, and its sixteen check names are still frozen as a fixture rather than a type. That is a separate problem, and this decision does not address it.
- Reversible on purpose: nothing here forecloses Option A. A third caller for these rules is the evidence that would justify it, and there is none today.

### Confirmation

`git grep -n "isWorktreeDirty" src/` shows `src/host/dirty-worktree.ts` as its only caller, so no second path reads the worktree and words its own answer.

`tests/host/dirty-worktree.test.ts` covers the four cases the rule has — `merge` and `pull-request` landing, dirty and clean — and asserts the base branch reaches the sentence.
It asserts the sentence's phrases rather than its full text, so an edit to operator prose is not a test failure.

`tests/doctor/doctor.test.ts` keeps asserting that a dirty worktree is a `warning` and leaves the exit code alone, which is doctor's own promise and not the rule's.
`tests/pass/pass.test.ts` keeps asserting the refusal and its exit code.

## More Information

- Provenance: the grilling of 2026-07-30 on candidate `#c1` of the architecture review of the same day.
- Related: [ADR-0015](0015-a-repo-declares-how-a-pass-lands.md) — the **landing** the shared rule gates on.
- Related: [ADR-0016](0016-the-base-branch-is-the-hosts-checkout.md) — why the base branch is read from the host's checkout, which is what the rule names in its sentence.
- Related: [ADR-0017](0017-the-lander-rebases-and-the-host-only-fast-forwards.md) — why a dirty worktree is refused under `merge` at all.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
