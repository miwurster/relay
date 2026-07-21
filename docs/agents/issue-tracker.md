# Issue tracker: Jira

Issues and specs for this repo live in Jira, reached through the **Atlassian MCP** — there is no CLI.

## Setup constants

- **Jira project key:** `PSD` — every issue for this repo is created in this project.
- **Repo label:** `repo:sandcastle` — the only thing that scopes work in this shared project to this repo.
- **Cloud id:** `35183b42-c98a-4cd0-a8a7-32a27ea7856e` — the kipu-quantum Atlassian site id passed on every MCP tool call.
  Per-site constant (same across every repo on this Jira site); changes only if the site migrates.
  Required only for a **headless/afk** (non-OAuth) agent, which cannot resolve it at runtime.
  An interactive OAuth agent may resolve it via `getAccessibleAtlassianResources` instead, but should prefer this pinned value.

This Jira project is shared across multiple repos.
The repo label is the only thing that scopes work to this repo.
**Always apply `repo:sandcastle` on create, and always filter by it on read.**

## The spec/ticket → Story/Task mapping

The engineering skills speak Matt Pocock's vocabulary — a **spec** and its **tickets**.
On Jira those map onto issue types:

- A **spec** (from `/to-spec`) is a Jira **`Story`** — a user-goal-level feature description.
- A **ticket** (a tracer-bullet vertical slice from `/to-tickets`) is a Jira **`Task`**.

Everywhere below, "spec" means the `Story` and "ticket" means the `Task`.

## Conventions (Atlassian MCP)

The tool names below are the Atlassian Remote MCP Jira tools.
Confirm the exact names against the available tool list — search `jira` if they aren't loaded yet.
If a call fails with an auth error, run the MCP's authenticate tool, then retry.

- **Create an issue:** `createJiraIssue` in project `PSD`, `summary` = title, `description` = body.
  Pick the issue type by the publishing skill (see **Issue types** below); default to `Task`.
  Set `labels` to include `repo:sandcastle`, plus `needs-triage` for a raw issue you triage.
  `/to-tickets` tickets get `repo:sandcastle` **and** `ready-for-agent` (see **Triage labels**); `ready-for-agent` is otherwise never set at creation — a skill stamps it later.
  For `/to-tickets` tickets, also declare their **blocking edges** (see **Blocking edges between tickets**).
- **Link two issues:** `createIssueLink` between an inward and an outward issue with a link type.
  List the project's link types with `getIssueLinkTypes` when unsure of the exact name.
- **Read an issue:** `getJiraIssue` by key (e.g. `PSD-123`), requesting comments, labels, and issue links.
- **List / search issues:** `searchJiraIssuesUsingJql`, always scoping the JQL to this repo: `project = PSD AND labels = "repo:sandcastle"`, adding state filters such as `AND labels = "ready-for-agent"`.
- **Comment on an issue:** `addCommentToJiraIssue`.
- **Apply / remove labels:** `editJiraIssue`, editing the `labels` field.
  Never drop `repo:sandcastle`.
- **Close / change triage state:** triage state is tracked with **labels** (see `triage-labels.md`), exactly like the other trackers — apply or remove the role label.
  You may _additionally_ move the Jira status with `transitionJiraIssue` when the project's workflow has a matching status, but the labels are the source of truth so the skills stay portable across projects.

The Jira **issue key** (`PSD-123`) plays the role that the issue number plays for GitHub / GitLab.

## Issue types

Pass these names verbatim as `issueTypeName` on `createJiraIssue`.
They are the standard Jira issue-type names; if `createJiraIssue` rejects one, list the project's real types with `getJiraProjectIssueTypesMetadata` and use the closest match.

- **`to-spec`** publishes the spec as a **`Story`** — a user-goal-level feature description, not a unit of work.
- **`to-tickets`** publishes each tracer-bullet ticket as a **`Task`**.
- **`qa`** files bugs as **`Bug`**.
- Any other skill with no clear fit: default to **`Task`**.

## Blocking edges between tickets

`/to-tickets` produces tracer-bullet tickets (`Task`s), each declaring the tickets that **block** it — the ones that must complete before it can start.
On Jira, a blocking edge is a **native "is blocked by" issue link**.

- Publish the tickets in dependency order (blockers first) so each blocking edge can reference a real issue key.
- For each ticket, create its blocking edges with `createIssueLink` using the **`Blocks`** link type: the blocker is the **outward** `Blocks` issue, the dependent is `is blocked by` it.
  If `Blocks` is rejected, list the project's real link types with `getIssueLinkTypes` and use the closest "blocks / is blocked by" equivalent; if the project has no blocking link type at all, fall back to a `Blocked by: PSD-NN, …` line at the top of the ticket description.
- A ticket is **unblocked** when every blocker is **Done** (`statusCategory = Done`).
  Because the machine never merges, a blocker becomes Done only after a human merges its MR and closes it — so dependent tickets wait for that human step.
- Optionally relate a ticket back to its spec (`Story`) with the **`Relates`** link type, for context — but the operational dependency is the blocking edge, not the spec link.

## Automation lifecycle (`kipu-implement` / `kipu-afk`)

These skills drive **one ticket** (`Task`) from `ready-for-agent` to an open **Merge request** with it **In Review**.
They call tracker-neutral operations that map to Jira as follows.

- **Read the ticket's brief.** The ticket's `description` (from `getJiraIssue`) **is** the brief — the single source of what to build.
- **Read the ticket's blocking edges.** From the ticket's issue links (`getJiraIssue`): the issues that **block** it.
  The loop only grabs a ticket whose blockers are all **Done** (see **Frontier query**).
- **Read the ticket's spec for context** (optional).
  If the ticket `Relates` to a `Story`, read it for the surrounding spec.
- **Reflect the ticket's state** (`transitionJiraIssue`): **In Progress** when the ticket starts; **In Review** when it is implemented, reviewed, and committed — never **Done** (a human step).
  If a status name is rejected, list the workflow's statuses with `getTransitionsForJiraIssue` and use the closest match.
- **Claim the issue** (`editJiraIssue`, `assignee`): on pick, assign it to the **current user** — the identity the MCP is authenticated as, resolved via `atlassianUserInfo`.
  Attended that is the operator; unattended it is the loop's service account.
  Do this in both modes, so the assignee records who ran it.
- **Loop labels** (`editJiraIssue`, never dropping `repo:sandcastle`): **`agent-running`** while a run holds the ticket; **`agent-blocked`** when a run cannot finish, always with a comment (`addCommentToJiraIssue`) saying why.
- **Comment a blocker.** `addCommentToJiraIssue`.

## Frontier query

The loop works the **frontier** — `ready-for-agent` tickets whose blockers are all Done.

- Eligible set (JQL), scoped to this repo: `project = PSD AND labels = "repo:sandcastle" AND labels = "ready-for-agent" AND statusCategory != Done AND labels not in ("agent-running")` (add `AND assignee = currentUser()` for a per-operator loop).
- Then drop any candidate that still has an **open blocker**: read its issue links (`getJiraIssue`) and skip it if any `is blocked by` issue is not `statusCategory = Done` (or any key in a `Blocked by:` description line is still open).
  First in dependency order wins.

## Triage labels

The five canonical triage roles are Jira labels, applied alongside `repo:sandcastle`.
See `triage-labels.md` for the mapping.

`ready-for-agent` is stamped by a skill, never hand-set at creation.
Two paths reach it:

- **Triage** — for issues you did **not** create (`qa` Bugs, Vulnerabilities, incoming requests).
  They start `needs-triage` and move across the role labels; when one is ready to act on, `/triage` posts an agent brief comment (see the `triage` skill's `AGENT-BRIEF.md`) and stamps `ready-for-agent` — or `ready-for-human` — on that **same** ticket.
  Do **not** route a triaged issue through `/to-spec`; triage self-stamps.
- **Main flow** — for new feature work.
  `/to-spec` stamps `ready-for-agent` on the spec (`Story`) when it is implemented directly; `/to-tickets` stamps **every ticket** (`Task`) it creates — each is agent-grabbable by construction.

The loop then picks up any `ready-for-agent` ticket on the **frontier** (see **Frontier query**), whatever its issuetype, since it keys on the label plus the blocking edges.

## Wayfinding operations

Used by `/wayfinder`.
The **map** is a single issue with **child** tickets under it.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
  Create it with `createJiraIssue` (issuetype `Epic` if the project has one, else `Story`), labels `repo:sandcastle` + `wayfinder:map`.
- **Child ticket**: a `Task` carrying `repo:sandcastle` and `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`), related to the map with `createIssueLink` (`Relates`) and `Part of PSD-<map>` at the top of its description.
  Once claimed, the ticket is assigned to the driving dev (`editJiraIssue` assignee).
- **Blocking**: native "is blocked by" links, exactly as **Blocking edges between tickets** — a child is unblocked when every blocker is `statusCategory = Done`.
- **Frontier query**: the map's open children (`searchJiraIssuesUsingJql` scoped to the map's linked issues) minus any with an open blocker or an assignee; first in map order wins.
- **Claim**: `editJiraIssue` to set the assignee — the session's first write.
- **Resolve**: `addCommentToJiraIssue` with the answer, transition the child to Done, then append a context pointer to the map's Decisions-so-far (`editJiraIssue` on the map description or a comment).

## Pull / merge requests as a triage surface

Not applicable.
Jira issues are the only request surface; code review lives in the git host.
Skills that look for "external PRs/MRs to triage" should skip that step for this repo.

## When a skill says "publish to the issue tracker"

Create a Jira issue in project `PSD` with the issue type for the publishing skill (see **Issue types** — `Story` for `to-spec`, `Task` for `to-tickets`) and label `repo:sandcastle`; add `needs-triage` only for a raw issue you triage.
`/to-tickets` tickets get `repo:sandcastle` **and** `ready-for-agent`, plus their blocking edges (see **Blocking edges between tickets**); a raw triaged issue's `ready-for-agent` is stamped later by `/triage`, never at creation (see **Triage labels**).

## When a skill says "fetch the relevant ticket"

`getJiraIssue` by key, or `searchJiraIssuesUsingJql` scoped to `project = PSD AND labels = "repo:sandcastle"`.
