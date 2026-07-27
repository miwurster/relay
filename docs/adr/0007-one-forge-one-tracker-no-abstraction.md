# 0007. One forge, one tracker, and no abstraction over either

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

relay was built against Jira for the tracker and GitLab for the forge.
Both are being dropped for GitHub, everywhere, at once.

The switch touches nearly every seam relay has: the host's work-item selection, the **tracker doc** contract, the sandbox's tool surface, the secrets it carries, and the planner and handover prompts.
Something that reaches that far invites a tempting move — introduce a tracker interface while everything is already open, so the next switch is cheap.

The question this ADR settles is not *which* tracker, but whether relay is allowed to know the answer.

## Decision Drivers

- relay hardcodes tracker assumptions only where the **tracker doc** does not already absorb them; per-repo variation has an owner already.
- Every tracker-facing **role** is a *prompt*, not a code path — a prompt tells an agent to run `gh`, and no interface can abstract prose.
- A seam with exactly one implementation is carrying cost with no buyer.
- The switch is a hard one: no repo relay runs against will be on Jira or GitLab afterwards.

## Considered Options

- **Option A** — Hardcode GitHub. One tracker module, GitHub vocabulary in the prompts, no indirection.
- **Option B** — A `Tracker` / `Forge` interface with a GitHub implementation, so a second one can be added later.
- **Option C** — Keep Jira and GitLab working and add GitHub alongside them, selected per repo.

## Decision Outcome

Chosen option: **Option A**, because the variation point relay actually has is the **tracker doc**, not a TypeScript interface.

- One module, `src/github.ts`, holds the host's read-and-comment slice, and nothing implements an interface it is the only member of.
- The **tracker doc** stays the place per-repo variation lives, which is what makes the hardcoding tolerable: relay names GitHub, and the doc names the repo's own conventions.
- The prompts say `gh` outright.
- Nothing named `Jira` or `GitLab` survives — not a type, not a variable, not a comment. A hard switch that left the old vocabulary lying around would leave every reader guessing whether it is dead or load-bearing.

Option C is not a middle ground but the sum of both costs: two tracker models, two credential shapes, two forge vocabularies in the prompts, and a per-repo selector deciding between them — all to serve zero repos.

### Consequences

- Good: the code says what it does. A reader finds one tracker module and one forge, with no dispatch to follow.
- Good: the switch **deletes** more than it adds — the Atlassian MCP config, its temp dir, mount and teardown, `RUNNABLE_TYPES`, `TrackerScope`, and the tracker-doc setup-constant parser all go.
- Good: `gh` in place of REST-plus-MCP means one mechanism host-side and in-sandbox, so an operator debugging a pass reaches for the same tool relay used.
- Bad: a future tracker means touching the same seams again, with no adapter to slot into. Accepted — that is a real cost paid *if* it happens, against a certain cost paid now.
- Bad: relay is unusable against a Jira or GitLab repo from this point, with no flag to get the old behaviour back. That is what "hard switch" means, and a half-switch would be worse.
- Bad: GitHub Enterprise Server is unaddressed. `relay.config.ts` loses its tracker base URL with nothing replacing it, so github.com is assumed until someone needs otherwise — and issue dependencies are `fpt`/`ghec` only anyway.

### Confirmation

No `Tracker` or `Forge` interface exists, and `src/github.ts` is the only module that talks to the tracker host-side.
`git grep -i 'jira\|gitlab\|glab\|merge request'` returns nothing outside `docs/adr/` and `.scratch/`, where the history is supposed to mention them, and where the mention is load-bearing rather than leftover:

- **relay's own CI and release** — `.gitlab-ci.yml`, `.fossa.yml`, `.releaserc.json` and `docs/release.md`.
  relay is itself hosted on GitLab.
  Where relay is published is not what tracker it speaks, and moving it is a separate change.
- **the migration guardrail** — `src/config.ts` and its test, which exist to reject a leftover `jira` block loudly so a repo cannot half-migrate.
- **the migration checklist** — `docs/migrating-a-repo-to-relay.md`, which is written for a repo that is still on the old systems and must name what it is telling the operator to remove.
- **negative assertions** — tests asserting the old vocabulary is *absent*, which must name it to forbid it.

## Pros and Cons of the Options

### Option B — a tracker interface with one implementation

- Good, because a second tracker would be additive rather than invasive.
- Good, because the interface would document the tracker surface relay depends on, which is currently implicit.
- Bad, because the tracker-facing **roles** are prompts telling an agent to run a CLI, so the interface could only ever cover the host's thin slice — the part that was never the expensive half.
- Bad, because an interface with one implementation gets shaped by that implementation, so it would not fit the second tracker anyway. The honest version of this work is done when a second tracker exists.
- Bad, because it contradicts relay's stated preference for the minimum code that solves the problem, over speculative flexibility.

### Option C — Jira, GitLab and GitHub side by side

- Good, because no repo would need migrating on relay's schedule.
- Bad, because every seam pays for both models permanently, and the eligibility rules would have to agree across trackers that model status, types and blocking differently.
- Bad, because a per-repo selector means two code paths where only one is ever exercised, so the unused one rots silently.

## More Information

- Provenance: `.scratch/github-switch/decisions.md`, grilling of 2026-07-26.
- API facts the switch rests on: `.scratch/github-switch/research/01-github-api-shape.md`.
- Related: [ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md) — what relay hardcodes, now that it is allowed to.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
