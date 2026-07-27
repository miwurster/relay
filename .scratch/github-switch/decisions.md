# github-switch: decisions

relay drops Jira and GitLab and speaks GitHub only.
A hard switch: no dual support, no tracker abstraction, no compatibility path.

These are the decisions the spec is written against.
They came out of a grilling session on 2026-07-26, then decisions 3, 7, 9 and 12 were amended once the API research landed.

**Destination:** a spec for relay's code switch — host code, role prompts, domain docs, and the target-repo `docs/agents/issue-tracker.md` contract.

**Research:** `.scratch/github-switch/research/01-github-api-shape.md`, on the throwaway branch `research/github-api-shape` (commit `897b9d6`).
Verified live against gh 2.96.0.

## Out of scope

- relay's own CI and release — `.gitlab-ci.yml`, `.releaserc.json`'s `@semantic-release/gitlab`, and the npm trusted-publishing setup pointed at the GitLab project. Independently landable, and mechanical next to the forge seam.
- The `kipu-all` plugin skills — `kipu-mr`, `kipu-release-mr`, `triage-dependency-bumps` are all `glab`-based and live in another repo.
- relay's own issue tracker. This repo keeps its local-markdown tracker under `.scratch/`; moving relay's own issues to GitHub is a separate effort from teaching relay to speak GitHub.

## Decisions

### 1. Issues live in the code repo

The repo relay runs in owns its own issues.
`Repo label` dies as a concept: repo identity *is* scope.

Cost accepted: a cross-repo epic has nowhere to live.

### 2. Lifecycle is labels; `closed` means done

GitHub issues carry only `open`/`closed`, so the three Jira states become labels:

- planner adds `agent-in-progress`;
- handover swaps it for `agent-in-review` on success, `agent-blocked` on a block.

Eligibility reads `state: open`.
"Ensure, do not set" survives as idempotent label edits — no transitions list to read, no per-project ids to hardcode.
relay never closes an issue.

Labels, not a GitHub Project v2 status field: a Project needs GraphQL and puts project, field and option ids in the tracker doc, which is exactly the id-hardcoding today's prompts avoid.
`docs/agents/triage-labels.md` already establishes labels as this org's state vocabulary.

### 3. No runnable-type gate

`RUNNABLE_TYPES` and `JiraIssue.issueType` are deleted, along with the planner prompt's issue-type-mapping paragraph.

The gate existed because one Jira project held Epics, Spikes and Documentation in the same query.
On GitHub two things carry that weight instead:

- the sub-issue graph answers work-item-vs-ticket — a parent with sub-issues is a work item, its leaves are tickets, a childless issue is its own single ticket, which is already what the planner does;
- `ready-for-agent` is a deliberate human act, so an unsuitable item never gets labelled.

An Epic stops being a hazard and becomes the ordinary multi-ticket case.

### 4. `gh` CLI everywhere, host and sandbox

One mechanism, and the one the tracker-doc seed already prescribes.
The host shells out to `gh` and parses `--json`; the sandbox roles run `gh` directly.

`gh` joins Docker as a host prerequisite, with its own doctor check.

This deletes a subsystem rather than porting one: the Atlassian MCP config generation, its temp dir, its mount and its teardown all go from `src/sandbox.ts`.
The sandbox image needs `gh` in place of `glab` regardless, since the handover pushes and opens the PR there.

### 5. Frontier is longest-waiting first

GitHub issues have no priority field, so `CONTEXT.md`'s **Frontier** entry loses "most important and".
Humans steer by *when* they apply `ready-for-agent`.

The frontier is only a prefilter — a human who wants a specific item names it, and it faces the same gates.

### 6. Blockers are native issue dependencies

No body-convention fallback: the research killed it.
`gh issue list --json blockedBy` resolves the real edges in **one** GraphQL call for a whole page, so the reserved `Blocked by: #n` line buys nothing.

Two obligations this puts on relay:

- **Open-blocker filtering is relay's own.** GraphQL `blockedBy.totalCount` counts closed blockers too, so eligibility filters `blockedBy[].state == "OPEN"`. Note the case: these nodes report `"OPEN"`/`"CLOSED"` while REST reports lowercase.
- **A cross-repo blocker is spotted from its `url`.** `gh` requests a `repository` field on those nodes but it never appears in the output.

**Never write a dependency edge with `gh api`.**
Passing an issue *number* where `POST …/issues/{n}/dependencies/blocked_by` wants the numeric database `id` returns 201 and silently links a stranger's issue in another repo — reproduced during the research.
Use `gh issue edit --add-blocked-by <number>`.

### 7. Tickets are native sub-issues

Same native-graph bet as decision 6, and the body-task-list fallback is dropped for the same reason: `--parent` and the `subIssues` JSON field cover it, and a task list's checkbox state is a second, disagreeing source of "done".

Sub-issue ordering is undocumented — empirically insertion order.
Sort by number, and order the plan by the dependency edges.

### 8. One fine-grained PAT, injected as `GH_TOKEN`

`Secrets` collapses from the Atlassian pair plus `GITLAB_TOKEN` to `{ github, claude }`.
`resolveClaudeCredential` is untouched.

`GH_TOKEN`, not `GITHUB_TOKEN`: `gh` prefers it, and it avoids colliding with the variable GitHub Actions injects should relay ever run there.

Permissions: `Issues: write` (which covers sub-issues, dependencies, issues and labels alike), `Pull requests: write`, `Contents: write`, `Metadata: read`.

Not a GitHub App: minting a JWT and exchanging it for an installation token would make `secrets.ts` grow logic instead of shrinking.

ADR 0005 names GitLab explicitly and needs amending.

### 9. The handover runs `gh pr create` directly

The prompt drops its `kipu-all:kipu-mr` delegation and the `glab mr update --draft` follow-up.
`gh pr create --draft` covers a mid-block in one command.

relay stops depending on a `kipu-all` skill for its own critical path, and the prompt gains concrete lines instead of an indirection.

The handover leg still publishes — not the harness.
Only the leg knows what to write in the PR body, and legs doing the work while the harness judges is the shape ADR 0001 sets up.

### 10. The PR body closes only child tickets, never a parent

`Closes #<child>` for each ticket the pass committed.
When the work item is a childless single ticket, that is the same thing.

relay never writes a closing keyword against a parent.
GitHub's closing-keywords docs never mention hierarchies, and a probe showed it neither refuses nor warns: closing a parent left both children open and marked the parent `completed` with `0 of 2`.

So a human closes the parent after merging.
That is visible rather than silent, because GitHub shows the `2 of 2` count.

### 11. The repo is inferred from the git remote

`TrackerScope` and the setup-constant parser in `src/tracker-doc.ts` are both deleted.
`gh` infers the repo from the clone, as the tracker-doc seed prescribes.

`tracker-doc.ts` keeps only `TRACKER_DOC_PATH` and an existence check — every tracker-facing role is told to read that doc, so a missing one still fails early.

`CONTEXT.md`'s **Tracker doc** entry drops its "scope comes from this file, never from the git remote" clause.
That rule existed because one Jira project spanned many repos; decision 1 made repo identity *be* scope, so its reason has evaporated.

`relay.config.ts` loses `jira: { baseUrl }` with nothing replacing it — github.com is assumed, and no GitHub Enterprise host knob until someone needs one.

### 12. A work item is a bare number

Branch `agent/42`.
`WORK_ITEM_KEY` becomes `WORK_ITEM` across the prompts, and the word "key" leaves the vocabulary.

The CLI accepts `42`, `#42` or a full issue URL and normalises to the number, since all three are what a human will paste.

No title slug in the branch name: the branch is ephemeral and never reused, and the PR title carries human readability.

### 13. `agent-in-progress` is the hold

`CONTEXT.md` lists "not already held" as an eligibility gate that `work-item.ts` never implemented — Jira's In Progress transition was the de-facto hold.
Now eligibility rejects an item carrying `agent-in-progress`.

Not the assignee, GitHub-native though it is: relay's service account would then own a field humans use to assign work to each other.

A crashed pass leaves the item visibly held, which is what ADR 0003 wants.

### 14. Target repos migrate by checklist, with a `gh` preflight

The sandbox image is built from the *target repo's* `docker/relay.Dockerfile`, so `glab` is installed by a file relay does not own.

The spec carries the per-repo checklist:

- `docs/agents/issue-tracker.md` — replace with the GitHub tracker doc;
- the Dockerfile — `gh` in place of `glab`;
- `relay.config.ts` — drop the `jira` block.

relay checks `gh --version` in the sandbox before the first leg, so a stale image fails in seconds rather than at the handover forty minutes in.

`relay.config.ts`'s schema is a `strictObject`, so a leftover `jira` block already fails loudly on its own.

### 15. The switch gets an ADR

A new ADR — "one forge, one tracker, no abstraction" — records why relay hardcodes GitHub rather than introducing a tracker interface.
That is the decision most likely to be re-litigated, and code plus `CONTEXT.md` only ever record *what*, never *why not*.

ADR 0002 and ADR 0005 have their GitLab references corrected in place.
Neither is superseded.

## Vocabulary

Mechanical, not decisions.

- merge request becomes pull request, throughout `CONTEXT.md`, `src/handover.ts`, `src/resources/handover.md` and the README.
- `mrUrl` becomes `prUrl`; `HandoverLeg.mergeRequest` and `enforceMergeRequestRule` rename to match.
- `src/jira.ts` becomes `src/github.ts`; `JiraClient`, `JiraIssue`, `JiraBlocker`, `JiraCredentials` and `JiraError` follow.
- `tests/jira.test.ts` follows its module.
- `pass.ts`'s crash comment changes "The item is left In Progress" to "The item is left labelled `agent-in-progress`".
