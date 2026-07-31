# 0028. The tracker doc owns invocation, relay owns the graph

- **Status:** accepted
- **Date:** 2026-07-31

## Context and Problem Statement

[ADR-0018](0018-legs-read-the-tracker-themselves.md) sends every tracker-facing **leg** to the **tracker doc** and forbids a prompt from carrying tracker content.
[ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) says the opposite-sounding thing: "the prompts say `gh` outright".
Both are accepted, and neither says where the line between them falls.

The prompts had already drifted along that undrawn line.
The handover states `gh pr create` and `gh repo view --json defaultBranchRef` outright while naming no `gh issue` command at all, and asserts the parent-child relation directly — "when {{WORK_ITEM}} has sub-issues the tickets are those sub-issues".
The planner and the review, for the same relation, deferred: "under the relation model the doc describes".
One of the three had to be wrong, and nothing written down said which.

The drift is not cosmetic.
The tracker doc belongs to the **target repo** — relay never writes it — and the one shipped with this repo describes, for `/wayfinder`, exactly the body-convention fallback [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md) refused: "Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body."
A leg told the doc is its source for the relation model may follow that in good faith, and build a plan the host cannot see.

Absent this record, the first reader to notice `gh pr create` in a prompt proposes moving it behind the doc — which is how this ADR came to be written.

## Decision Drivers

- The **tracker doc** is the target repo's file and the place per-repo variation lives, which is what makes relay's hardcoding of GitHub tolerable (ADR-0007).
- A command varies per repo — `gh api` on the sub-issues endpoint, `gh issue list --json subIssues`, an enterprise wrapper. The graph those commands return does not.
- relay's **eligibility check** gates a **work item** on the native graph, host-side and unconfigurably. A leg planning against a different graph disagrees with the gate that admitted the work.
- A pull request is the **pass**'s own publication act, and its shape — the base, the `Closes` line per committed ticket — is relay's contract, not the repo's convention.
- ADR-0018's driver was staleness and graph-following, neither of which applies to an act relay is performing rather than reading.

## Considered Options

- **Option A** — the doc owns how an operation is invoked; relay owns what the graph is, and states forge commands outright.
- **Option B** — everything tracker-adjacent goes behind the doc, `gh pr create` included.
- **Option C** — relay owns the whole graph including the read command, and the doc is left owning item operations only.

## Decision Outcome

Chosen option: **Option A**.

A prompt may state a **forge** command outright — the branch, the pull request, the repository.
A prompt states no **tracker-item** command, ever: it reads `{{TRACKER_DOC}}` and runs what that doc says, for reading, commenting, labelling, closing and rewriting a body alike.

The doc's authority stops at invocation.
What a ticket list *is* does not vary: the tickets under a work item are its own GitHub sub-issues, its blockers are its own GitHub issue dependencies, and a task list or a `Blocked by:` body line is neither.
Each of the three tracker-reading prompts says so in its own words, because relay ships one prompt file per **role** with no include mechanism, and a placeholder carrying relay's own prose would be the argument channel ADR-0018 confined to the pass's facts.

**Option B** was rejected because the doc has no opinion to defer to: its `gh pr` section is gated behind a "PRs as a request surface" flag about triaging *external* pull requests, and says nothing about a pass publishing its own branch.
Deferring would put relay's publication contract in a file the target repo edits.

**Option C** was rejected because the command is the part that genuinely varies per repo, and hardcoding it would override the doc for no gain — the model statement already prevents the wrong answer.

### Consequences

- Good: the asymmetry between `gh pr create` and `gh issue close` has a reason a reader can find, instead of looking like an oversight to correct.
- Good: the host and the legs plan against one graph, so a pass cannot be gated on one relation model and built on another.
- Good: the tracker doc keeps every per-repo command, and relay still writes none of it.
- Bad: three prompts state the model in three places and can drift again. Asserted per role, which is where this repo keeps prompt wording.
- Bad: on a platform without native sub-issues the field comes back empty, which a planner reads as the ordinary childless item and runs as a single ticket — a wrong plan, silently. Accepted: ADR-0007 already records that github.com is assumed and that issue dependencies are `fpt`/`ghec` only, so a `doctor` probe would be checking for a platform relay does not claim to support. Neither `doctor` nor the planner can tell "no children" from "no graph" without a capability probe for that unsupported case, and making the planner hesitate would make the ordinary single-ticket item ask permission.

### Confirmation

No prompt resource under `src/resources` contains the string `gh issue`, swept over every prompt in `tests/resources.test.ts` rather than asserted for one.
The guard names `gh issue` rather than `gh` deliberately: `gh pr create` and `gh repo view` are required of the handover.
`src/resources/planner.md` and `src/resources/review.md` state the native relation model and refuse the fallback by name; `src/resources/handover.md` takes its tickets from the item's own sub-issues.
Each of the three is asserted in that role's own test.
`{{TRACKER_DOC}}` is named in a prompt as the source for tracker access and operations only; no prompt names it as the source for a relation.

## More Information

- Provenance: the grilling of 2026-07-31 on hardcoded tracker commands in prompts.
- Amends [ADR-0018](0018-legs-read-the-tracker-themselves.md), whose Confirmation reads "No prompt resource contains tracker content" without saying that a forge command is not tracker content.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) — why the prompts say `gh` at all.
- Related: [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md) — the graph this ADR refuses to let a doc redefine.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
