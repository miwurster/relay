# GitHub sub-issues and issue dependencies via the `gh` CLI

Research for relay's switch from Jira + GitLab to GitHub Issues + GitHub PRs.
Primary sources only: `docs.github.com`, the `github/docs` and `github/rest-api-description` repos (GitHub-owned), `github.blog/changelog`, the `cli/cli` source at tag `v2.96.0`, and the installed `gh` binary.

**Locally verified at `gh version 2.96.0 (2026-07-02)`** (`gh --version`), authenticated as `miwurster` with token scopes `gist`, `read:org`, `repo`.
Live probes were run against the public repo `miwurster/relay` (five throwaway issues `#1`–`#5`, created, exercised, then deleted — `gh issue list --state all` is empty again) and against read-only public repos (`cli/cli`, `lvb2104/OS-Visualization`, `Steliospne/virtality-platform`).

Everything below is either **[doc]** (quoted from a primary source), **[local]** (observed from the installed `gh` / the live API), **[gap]** (the docs are silent), or **[inference]** (my reasoning, not a documented fact).

---

## 1. Dependency summary cost — is the frontier scan one call or N+1?

**Direct answer: one call.**
`gh issue list --json blockedBy,...` exposes the full blocked-by edge list per issue in a single GraphQL request for the whole page — no `issue_dependencies_summary`, no per-issue REST call.
There is *also* a search qualifier, `is:blocked`, that filters the list server-side and correctly tracks *open* blockers only, so relay's frontier can be a single `gh issue list` invocation.

`gh issue list --json` does **not** expose `issue_dependencies_summary` (that is a REST-only field). It exposes something better: the resolved edges.

### Evidence

`gh issue list` / `gh issue view` support the fields `blockedBy`, `blocking`, `parent`, `subIssues`, `subIssuesSummary` **[local]** — see §7 for the full inventory.

One request for a 60-issue page, all dependency fields included **[local]**:

```
$ GH_DEBUG=api gh issue list -R cli/cli --limit 60 --json number,blockedBy,subIssues,labels
> POST /graphql HTTP/1.1      # ← exactly one
```

The shape returned (`gh issue view 7 -R lvb2104/OS-Visualization --json blockedBy`) **[local]**:

```json
{"blockedBy":{"nodes":[
   {"id":"I_kwDOTkOjNc8AAAABKPQoKw","number":6,"state":"OPEN",
    "title":"…","url":"https://github.com/lvb2104/OS-Visualization/issues/6"}],
  "totalCount":3}}
```

`cli/cli` builds these fields with fixed page sizes (`api/query_builder.go` lines 447-456, tag `v2.96.0`) **[doc, source]**:

```go
case "subIssues":  q = append(q, `subIssues(first:100){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount}`)
case "blockedBy":  q = append(q, `blockedBy(first:50){nodes{…},totalCount}`)
case "blocking":   q = append(q, `blocking(first:50){nodes{…},totalCount}`)
```

`first:100` and `first:50` exactly match GitHub's documented maxima (100 sub-issues per parent, 50 links per relationship type — see §4), so **no truncation is possible** **[inference from the two documented caps]**.

Note: although the query asks for `repository{nameWithOwner}`, the JSON `gh` prints for these nodes contains only `id`, `number`, `title`, `url`, `state` — verified even for a genuinely cross-repository blocker **[local]**. To detect a cross-repo blocker relay must parse `url`, not look for a repository field.

### Search-qualifier route

`is:blocked` works, and combines with `--json` in the same single call **[local]**:

```
$ gh issue list -R miwurster/relay --search "is:blocked" --json number,title,blockedBy,labels
[{"blockedBy":{"nodes":[{"number":1,"state":"OPEN",…}],"totalCount":1},"labels":[],"number":2,…}]
```

Negation works too: `--search "-is:blocked"` returned every issue *except* the blocked one **[local]**.
`--label` and `--search` can be combined (`gh issue list --label bug --search "-is:blocked"`), which costs 2 GraphQL requests instead of 1 — still O(1) in the number of issues **[local]**.

Announced qualifiers **[doc]** — [Dependencies on issues (2025-08-21)](https://github.blog/changelog/2025-08-21-dependencies-on-issues/): "`is:blocked`", "`is:blocking`", "`blocked-by:`", "`blocking:`".
Verified: `is:blocked` and `is:blocking` work through the search API. **`blocked-by:` and `blocking:` returned `total_count: 0`** in both syntaxes tried (`blocked-by:6` and `blocked-by:owner/repo#6`) against a repo where `is:blocked` correctly returned 5 issues **[local]**.
**[gap]** These four qualifiers appear in *no* docs.github.com page — `github/docs` code search for the literal strings `"is:blocked"` and `"has:sub-issue"` returns 0 hits, while a control search for `"no:assignee"` returns 3, and the search reference [`searching-issues-and-pull-requests.md`](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests) never mentions blocking or sub-issues. Treat `blocked-by:` / `blocking:` as UI-only until GitHub documents them; treat `is:blocked` as real but undocumented outside the changelog.

### Recommendation for the frontier scan

Ask for the edges, not the qualifier:

```
gh issue list --label ready-for-agent --state open --limit 100 \
  --json number,title,labels,blockedBy,subIssues,subIssuesSummary
```

One HTTP request, and relay filters `blockedBy.nodes[].state == "OPEN"` itself.
Filtering client-side rather than trusting `is:blocked` is the safer choice because the qualifier is undocumented and `totalCount` is *not* an open-blocker count (see §2).

---

## 2. Dependency semantics — what counts, and how edges are created

**Direct answer:**
`issue_dependencies_summary.blocked_by` counts **only open** blockers; `total_blocked_by` counts **all** blockers including closed ones.
The GraphQL/`gh` side has no equivalent split: `blockedBy.totalCount` counts **all** blockers, closed included, so relay must filter `nodes[].state`.
Edges are created with `POST …/dependencies/blocked_by` taking the blocker's **numeric database `id`** — *not* the `#number`, *not* the `node_id` — and removed with `DELETE …/dependencies/blocked_by/{issue_id}` using that same database id.

### Exact field names and shape

`Issue Dependencies Summary` schema, from GitHub's own OpenAPI description (`github/rest-api-description`, `descriptions/api.github.com/api.github.com.json`, `components.schemas.issue-dependencies-summary`) **[doc]**:

```json
{"title":"Issue Dependencies Summary","type":"object","properties":{
  "blocked_by":{"type":"integer"},"blocking":{"type":"integer"},
  "total_blocked_by":{"type":"integer"},"total_blocking":{"type":"integer"}},
 "required":["blocked_by","blocking","total_blocked_by","total_blocking"]}
```

**[gap]** The schema carries **no `description` for any of the four fields** — neither the OpenAPI description nor [the REST docs page](https://docs.github.com/en/rest/issues/issue-dependencies) states what distinguishes `blocked_by` from `total_blocked_by`. This is a real documentation gap, so I resolved it experimentally.

Live experiment on `miwurster/relay` **[local]**, issue `#2` blocked by issue `#1`:

| state of blocker `#1` | `issue_dependencies_summary` on `#2` | `blockedBy.totalCount` (GraphQL) | `is:blocked` matches `#2`? |
| --- | --- | --- | --- |
| open | `{"blocked_by":1,"blocking":0,"total_blocked_by":1,"total_blocking":0}` | `1` (node `state:"OPEN"`) | yes |
| closed | `{"blocked_by":0,"blocking":0,"total_blocked_by":1,"total_blocking":0}` | `1` (node `state:"CLOSED"`) | no |

So: `blocked_by` = open blockers, `total_blocked_by` = all blockers, `is:blocked` = `blocked_by > 0`, and `blockedBy.totalCount` = `total_blocked_by`.

Two operational caveats **[local]**:

- The REST summary is **eventually consistent**. Immediately after `gh issue create --blocked-by 1`, `issue_dependencies_summary` still read all zeros while `GET …/dependencies/blocked_by` and the GraphQL `blockedBy` connection already showed the edge. Do not poll the summary as an ack.
- Nothing prevents closing a blocked issue: `gh issue close` on an issue with an open blocker succeeded with no warning and no error, `state: CLOSED`, `stateReason: COMPLETED`. **[gap]** Undocumented; relay must not assume GitHub enforces the gate.

### Creating and removing edges

Endpoints (OpenAPI, `category: issues`, `subcategory: issue-dependencies`; all `enabledForGitHubApps: true`, `githubCloudOnly: false`) **[doc]** — <https://docs.github.com/en/rest/issues/issue-dependencies>:

| Method | Path | Body / path param |
| --- | --- | --- |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` | — |
| `POST` | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by` | body `issue_id` (integer, required) — "The id of the issue that blocks the current issue" |
| `DELETE` | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}` | path `issue_id` (integer) — "The id of the blocking issue to remove as a dependency" |
| `GET` | `/repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking` | — |

There is no `POST …/dependencies/blocking` — you express "A blocks B" by posting A as a `blocked_by` of B.
Both `POST` and `DELETE` are marked `triggersNotification: true` and their descriptions warn: "Creating content too quickly using this endpoint may result in secondary rate limiting" / "Removing content too quickly …" **[doc]**.

**`issue_id` is the global numeric database id, and passing the wrong integer fails silently and dangerously** **[local]**:

- `node_id` is rejected outright: `422 Invalid property /issue_id: "I_kwDOTkL9ks8AAAABKPQ1ig" is not of type integer`.
- Passing the issue **number** `5` returned `201` and created a dependency on **database id 5** — which is `jbarnette/johnson#1`, an unrelated public issue in a foreign repo. `GET …/dependencies/blocked_by` then showed `{"id":5,"number":1,"repo":".../jbarnette/johnson"}`. So the API silently accepts a cross-repository mislink. (I removed it with `DELETE …/blocked_by/5`, which worked and left `length == 0`.)

**Conclusion for relay: never hand-roll these REST calls with issue numbers.** Use the `gh` wrappers, which take numbers or URLs and resolve node IDs themselves **[local, `gh issue create/edit --help`]**:

```
gh issue create --blocked-by 200,201 --blocking 300
gh issue edit 123 --add-blocked-by 200 --add-blocking 300,301
gh issue edit 123 --remove-blocked-by 200 --remove-blocking 300
```

Internally `gh` uses GraphQL mutations with node IDs (`cli/cli` `api/queries_issue.go` lines 569-611: `AddBlockedBy` / `RemoveBlockedBy` sending `issueId` + `blockingIssueId` as `githubv4.ID`) **[doc, source]**.
Same flags are documented at <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies>.

Cross-repository dependencies are supported: the webhook payloads carry a dedicated `blocking_issue_repo` / `blocked_issue_repo` (`webhook-issue-dependencies-blocked-by-added`) **[doc, OpenAPI]**, and my accidental mislink above proves it end-to-end **[local]**.

---

## 3. Sub-issues listing

**Direct answer:**
`GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues` lists them, and each entry is a **full issue object** — `number`, `state`, `title`, `labels`, `assignees`, `milestone`, `body`, `state_reason`, plus `parent_issue_url`, `sub_issues_summary` and `issue_dependencies_summary`.
But relay does not need `gh api` for this: `gh issue view N --json subIssues` returns the children (up to 100) with `number`, `title`, `state`, `url`, `id`, and `gh issue list --json subIssues` does it for a whole page in one call.
The list comes back in the parent's manual order and that order is settable via `PATCH …/sub_issues/priority`.

### Evidence

Endpoints (OpenAPI, `subcategory: sub-issues`) **[doc]** — <https://docs.github.com/en/rest/issues/sub-issues>:

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `…/issues/{issue_number}/sub_issues` | — (`per_page` max 100, `page`) |
| `POST` | `…/issues/{issue_number}/sub_issues` | `sub_issue_id` (int, required) — "The id of the sub-issue to add. The sub-issue must belong to the same repository owner as the parent issue"; `replace_parent` (bool) |
| `DELETE` | `…/issues/{issue_number}/sub_issue` (singular) | `sub_issue_id` (int, required) |
| `PATCH` | `…/issues/{issue_number}/sub_issues/priority` | `sub_issue_id` (required) + `after_id` **or** `before_id` |
| `GET` | `…/issues/{issue_number}/parent` | — |

Note the same `id`-not-number trap as §2: every `sub_issue_id` is a numeric database id **[doc]**.
Note also the asymmetry: add/list are on `/sub_issues`, remove is on `/sub_issue`.

Observed entry keys from `GET …/issues/199/sub_issues` on `Steliospne/virtality-platform` **[local]** — 33 keys including `number`, `state`, `state_reason`, `title`, `body`, `labels`, `assignees`, `milestone`, `parent_issue_url`, `sub_issues_summary`, `issue_dependencies_summary`, `repository`, `html_url`. Labels came through populated: `(200,'open','Lock the blog content schema',['wayfinder:grilling'])`.

### `gh` coverage

There is **no `gh issue sub-issue` subcommand** — `gh issue --help` lists only create/list/status/close/comment/delete/develop/edit/lock/pin/reopen/transfer/unlock/unpin/view **[local]**.
Sub-issues are reachable through flags and JSON fields instead **[local]**:

```
gh issue create --parent 100                     # or a URL
gh issue edit 100 --add-sub-issue 123,124
gh issue edit 100 --remove-sub-issue 123
gh issue edit 23  --parent 100 | --remove-parent
gh issue view  100 --json subIssues,subIssuesSummary
gh issue view  123 --json parent
```

Verified live **[local]**: creating `#4` and `#5` with `--parent 3` produced

```json
{"subIssues":{"nodes":[{"number":4,"state":"OPEN",…},{"number":5,"state":"OPEN",…}],"totalCount":2},
 "subIssuesSummary":{"completed":0,"percentCompleted":0,"total":2}}
```

and `GET …/issues/4/parent` returned `{"number":3}`. `gh issue edit 4 --parent 5` re-parented `#4` under `#5` without needing `replace_parent`, i.e. `gh` handles the reparent for you **[local]**.

GraphQL field descriptions, from live introspection of the API **[doc, the API itself]**:

| field | type | description |
| --- | --- | --- |
| `parent` | `Issue` | "The parent entity of the issue." |
| `subIssues` | `IssueConnection` | "A list of sub-issues associated with the Issue." |
| `subIssuesSummary` | `SubIssuesSummary` | "Summary of the state of an issue's sub-issues" (`total`, `completed`, `percentCompleted`) |
| `blockedBy` | `IssueConnection` | "A list of issues that are blocking this issue." |
| `blocking` | `IssueConnection` | "A list of issues that this issue is blocking." |

`subIssues` args are `after, before, first, last` — **no `states` filter and no `orderBy`**; `blockedBy` / `blocking` add `orderBy` **[local, introspection]**. Another reason relay filters open-ness client-side.

### Ordering

**Partly a [gap].** [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) says nothing about the order of the returned list, and neither the REST page nor the OpenAPI description documents a sort order or a sort parameter.
What *is* documented is that the order is a first-class, mutable property: the `PATCH …/sub_issues/priority` endpoint exists to "reprioritize a sub-issue to a different position in the parent list", with `after_id` / `before_id` **[doc]**.
Empirically the list came back in creation order (`#4` then `#5`) **[local]**, and `subIssues` offers no `orderBy` **[local]**.
**[inference]** The list is the parent's manual order (what the UI shows), stable across reads and settable via the priority endpoint — but GitHub has not committed to that in writing, so relay should not depend on order for correctness. Sort by `number` if it needs a deterministic order.

---

## 4. Availability and preconditions

**Direct answer: both features are generally available on github.com, for private repos, on every plan including Free — no preview, no opt-in, no special `Accept` header, and no required `X-GitHub-Api-Version` pin.**
The preconditions that matter are permission level (**triage** or above) and the documented caps: 100 sub-issues per parent, 8 levels of nesting, 50 links per dependency relationship type.

### Plan and version gating

`github/docs` frontmatter is the authoritative gating source.

Sub-issues — `data/features/sub-issues.yml` **[doc]**:

```yaml
versions:
  fpt: '*'        # Free, Pro, Team
  ghec: '*'       # GitHub Enterprise Cloud
  ghes: '>=3.18'  # GitHub Enterprise Server 3.18+
```

Issue dependencies — frontmatter of `content/issues/.../creating-issue-dependencies.md` **[doc]**:

```yaml
versions: { fpt: '*', ghec: '*' }
permissions: People with at least triage permissions for a repository can create issue dependencies.
product: Issue dependencies are available for users on GitHub Free, GitHub Pro, GitHub Team, and GitHub Enterprise Cloud plans.
```

Note dependencies have **no `ghes` entry** — cloud only for now **[doc]**. Not relevant to relay unless it ever targets GHES.

`permissions` frontmatter for sub-issues: "People with at least triage permissions for a repository can add sub-issues." **[doc]**

GA statements **[doc]**:

- Sub-issues: "we're thrilled to announce the general availability of sub-issues, issue types, advanced search, and increased item limits in GitHub Projects" — [2025-04-09](https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/).
- Dependencies: "Dependencies on issues are now generally available!" … "fully supported in the API and webhooks" — [2025-08-21](https://github.blog/changelog/2025-08-21-dependencies-on-issues/).
- `gh` support: "Anyone on GitHub CLI v2.94.0 or later can use the new hierarchy and dependency support" — [2026-06-10](https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/). Installed version is 2.96.0, so we are past the floor **[local]**.

Nothing in any of these sources gates the features by repository visibility **[doc, absence]**, and the OpenAPI entries are all `githubCloudOnly: false` **[doc]**.

### Headers

No custom `Accept` type is required. All these endpoints "support the following custom media types" — `application/vnd.github.raw+json` (the default), `.text+json`, `.html+json`, `.full+json` — which only vary body rendering **[doc, OpenAPI descriptions]**.
`X-GitHub-Api-Version` is optional: "Requests without the `X-GitHub-Api-Version` header will default to use the `2022-11-28` version" **[doc]** — <https://docs.github.com/en/rest/about-the-rest-api/api-versions>. Two versions are currently active: `2026-03-10` (no end date) and `2022-11-28` (ends 2028-03-10) **[doc]**. Everything measured here worked through `gh api` with no version pin **[local]**.
**[inference]** Pin `X-GitHub-Api-Version: 2022-11-28` anyway if relay ever calls REST directly, so a future default flip cannot move the response shape under it.

### Documented caps and caveats

- "You can add up to 100 sub-issues per parent issue and create up to eight levels of nested sub-issues." — [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) (the `100` resolves from `data/variables/projects.yml: sub-issue_limit: '100'`) **[doc]**. Raised from 50 at GA **[doc, 2025-04-09 changelog]**.
- "You can link up to 50 issues for each relationship type." — [2025-08-21 changelog](https://github.blog/changelog/2025-08-21-dependencies-on-issues/) **[doc]**.
- Secondary rate limiting is called out on every mutating endpoint (`POST`/`DELETE` sub-issue, `POST`/`DELETE` dependency) **[doc, OpenAPI]**. All four are also `triggersNotification: true` except `POST …/sub_issues`, so bulk wiring will spam watchers.
- No *beta* caveats remain; both features are GA **[doc]**.
- **[gap]** No documented endpoint-specific rate limit — only the generic secondary-limit warning.
- **[local]** The REST `issue_dependencies_summary` lags edge creation by seconds (§2).

---

## 5. Closing keywords over a tree

**Direct answer: this is a documentation gap, and the observed behaviour is "no protection at all".**
The docs never mention sub-issues or dependencies in the context of closing keywords, and closing a parent with open sub-issues is neither refused nor warned about by the API/CLI, and does **not** close the children.

### What is documented

[Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) **[doc]**: keywords are `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`; "you can manually link up to ten issues to each pull request"; cross-repo form is `KEYWORD OWNER/REPOSITORY#ISSUE-NUMBER`.
**[gap]** That page contains **no** statement about parents, sub-issues, hierarchies, blocked issues, or refusing to close. A `github/docs` code search for `"closing a parent"` returns 0 hits, and `browsing-sub-issues.md` says nothing about closing.

### What I measured

**[local]** On `miwurster/relay`, parent `#3` with two open sub-issues `#4`, `#5`:

```
$ gh issue close 3
✓ Closed issue miwurster/relay#3
$ gh api repos/miwurster/relay/issues/3 --jq '{state,state_reason,sub_issues_summary}'
{"state":"closed","state_reason":"completed","sub_issues_summary":{"total":2,"completed":0,…}}
$ gh api repos/miwurster/relay/issues/3/sub_issues --jq 'map({number,state})'
[{"number":4,"state":"open"},{"number":5,"state":"open"}]
```

So: closed the parent, no warning, no refusal, children untouched, and the parent is left in the contradictory state `completed` with `completed: 0 of 2`.
Separately, closing an issue that has an **open blocker** also succeeded with no warning (§2) **[local]**.

**[inference]** A `Closes #42` in a merged PR body drives the same close path as `gh issue close`, so it will close the parent, leave the children open, and say nothing. I did **not** verify this end-to-end, because closing keywords only fire on merge into the default branch and I was not willing to push a merge commit to `main` of a real repo. Treat as inference; if it matters, verify in a scratch repo.
**[gap]** The web UI is known to show a confirmation dialog when closing a parent with open sub-issues, but that is UI behaviour I could not verify and could not find documented; it is irrelevant to relay, which acts through the API.

**Implication:** relay must never write `Closes #<parent>` in a PR body. Close keywords may only ever target the leaf sub-issue the pass implemented, and the parent must be closed deliberately, after checking `subIssuesSummary.completed == total`.

---

## 6. Token scopes (fine-grained PAT)

**Direct answer: two repository permissions cover everything relay needs — `Issues: Read and write` and `Pull requests: Read and write` (plus `Contents: Read and write` to push the branch, and `Metadata: Read`, which is mandatory and implied).**

From <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens> **[doc]** — all of the sub-issue, dependency, issue and label endpoints are listed under the heading **"Repository permissions for \"Issues\""**:

| Capability | Permission | Level |
| --- | --- | --- |
| Read sub-issues (`GET …/sub_issues`, `GET …/parent`) | Issues | read |
| Write sub-issues (`POST …/sub_issues`, `DELETE …/sub_issue`, `PATCH …/sub_issues/priority`) | Issues | write |
| Read dependencies (`GET …/dependencies/blocked_by`, `…/blocking`) | Issues | read |
| Write dependencies (`POST …/dependencies/blocked_by`, `DELETE …/dependencies/blocked_by/{issue_id}`) | Issues | write |
| Create/edit issues (`POST /repos/{owner}/{repo}/issues`) | Issues | write |
| Manage labels (`POST /labels`, `PATCH /labels/{name}`, `DELETE /labels/{name}`) | Issues | write |
| Open pull requests (`POST /repos/{owner}/{repo}/pulls`) | Pull requests | write |

Repository-level effective permission also matters independently of the token: "People with at least **triage** permissions for a repository can create issue dependencies" / "… can add sub-issues" **[doc, docs frontmatter]**. A token cannot grant more than its owner has.

Two more notes:

- All eight sub-issue/dependency endpoints are `enabledForGitHubApps: true` **[doc, OpenAPI]**, so a GitHub App installation token works as well as a PAT.
- **[inference]** relay also needs `Contents: write` for pushing the branch the PR is built from, and `Metadata: read` is auto-required by every fine-grained token. Neither is a sub-issue/dependency fact, so I did not chase a citation.
- **[local]** For reference, the classic-scope equivalent is just `repo` — that is the token this research ran under, and it could read and write dependencies and sub-issues on a public repo.

---

## 7. `gh` field inventory

**Direct answer — verified locally at `gh version 2.96.0 (2026-07-02)`.**
`gh issue list --json` and `gh issue view --json` support **exactly the same 26 fields**, and the set already includes everything relay needs for hierarchy and dependencies.

`gh issue list --json 2>&1` and `gh issue view --json 2>&1` both print **[local]**:

```
assignees, author, blockedBy, blocking, body, closed, closedAt,
closedByPullRequestsReferences, comments, createdAt, id, isPinned, issueType,
labels, milestone, number, parent, projectCards, projectItems, reactionGroups,
state, stateReason, subIssues, subIssuesSummary, title, updatedAt, url
```

The five relevant ones and their exact JSON shapes, as observed **[local]**:

| field | shape |
| --- | --- |
| `parent` | `null`, or `{id, number, title, url, state}` |
| `subIssues` | `{nodes:[{id,number,title,url,state}], totalCount}` — `first:100` |
| `subIssuesSummary` | `{total, completed, percentCompleted}` |
| `blockedBy` | `{nodes:[{id,number,title,url,state}], totalCount}` — `first:50`, `totalCount` counts closed blockers too |
| `blocking` | `{nodes:[…], totalCount}` — `first:50` |

`state` in these nodes is the GraphQL enum, i.e. `"OPEN"` / `"CLOSED"` (uppercase) — unlike REST, which returns `"open"` / `"closed"` **[local]**. Easy bug if relay mixes the two paths.

Relevant flags, all verified from `--help` at 2.96.0 **[local]**:

- `gh issue create`: `--parent`, `--blocked-by`, `--blocking`, `--type`
- `gh issue edit`: `--parent`, `--remove-parent`, `--add-sub-issue`, `--remove-sub-issue`, `--add-blocked-by`, `--remove-blocked-by`, `--add-blocking`, `--remove-blocking`
- `gh issue list`: `--label`, `--search`, `--state`, `--type`, `--limit` (default 30 — relay must raise it)

There is **no** `gh issue list --parent` / `--blocked` filter flag, and **no** `gh issue sub-issue` subcommand **[local]**. Server-side filtering has to go through `--search`.

---

## What this means for relay

### Fallback 1 — a `Blocked by: #n` body convention instead of native dependencies

**Go native. Drop the body-convention fallback.**

- The data is available for a whole labelled frontier in **one** GraphQL call: `gh issue list --label ready-for-agent --json number,labels,blockedBy` (§1, locally verified single `POST /graphql` for 60 issues). There is no N+1 cost to avoid, so the convention buys nothing.
- The `first:50` page size matches the documented 50-link cap, so no truncation risk (§1, §4).
- Writing edges is safe as long as relay goes through `gh issue edit --add-blocked-by <number>` rather than raw REST — raw REST `issue_id` is a *database* id and silently mislinks to a foreign repo's issue if you pass a number (§2). This is the single sharpest footgun in this whole area; write it into relay's rules.
- Two things relay must implement itself, because GitHub does not: filter `blockedBy.nodes[].state == "OPEN"` (`totalCount` includes closed blockers, §2), and enforce the "don't close a blocked issue" rule (GitHub does not, §2).
- GA on Free/Pro/Team/GHEC for private repos, triage permission, no headers (§4). No preview gate to wait out.
- Do **not** build on `blocked-by:` / `blocking:` search qualifiers — announced in the changelog but returning 0 results through the search API today (§1). `is:blocked` works but is undocumented; prefer client-side filtering of `blockedBy`.

### Fallback 2 — a body task list instead of native sub-issues

**Go native. Drop the task-list fallback.**

- The planner can create tickets directly as children: `gh issue create --parent <n>` (§3), and the pass can read them either in the frontier call (`--json subIssues`) or with `gh issue view <parent> --json subIssues,subIssuesSummary` — no `gh api` needed, no HTML/markdown parsing.
- `subIssuesSummary` gives relay a free progress signal (`completed`/`total`) for the handover report (§3).
- 100 children per parent and 8 nesting levels (§4) are far beyond what one pass needs.
- Native sub-issues also give the labels relay's frontier depends on, on each child, in one REST call if ever needed (§3).
- Two constraints to design around: **ordering is not a documented guarantee** — treat the sub-issue list as unordered and sort by `number` (§3); and **closing a parent does not close children and is not blocked** — so relay's PR bodies must only ever `Closes #<child>`, with the parent closed explicitly once `subIssuesSummary.completed == total` (§5).

### Net shape of relay's GitHub calls

- Frontier scan, host-side, per pass: **1 call** — `gh issue list --label ready-for-agent --state open --limit 100 --json number,title,labels,blockedBy,subIssues,subIssuesSummary`, then filter out any issue with an `OPEN` node in `blockedBy`.
- Planner leg: `gh issue create --parent <n> …` per ticket; `gh issue edit --add-blocked-by` for intra-plan sequencing; both number-based, both safe.
- Token: fine-grained PAT with `Issues: write`, `Pull requests: write`, `Contents: write`, `Metadata: read`; actor needs at least triage on the repo.
