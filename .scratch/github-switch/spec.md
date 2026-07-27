# Spec: relay speaks GitHub only

Status: ready-for-agent

Decisions this spec is written against: `.scratch/github-switch/decisions.md`.
API facts it rests on: `.scratch/github-switch/research/01-github-api-shape.md`, verified against gh 2.96.0.
Architecture: [ADR-0007](../../docs/adr/0007-one-forge-one-tracker-no-abstraction.md), [ADR-0008](../../docs/adr/0008-the-native-github-graph-is-the-tracker-model.md).

## Problem Statement

relay only runs against Jira for the tracker and GitLab for the forge.
The team has moved to GitHub for both, so relay cannot run over any of the team's work at all — not because a feature is missing, but because every tracker-facing seam names the wrong system.

Concretely, an operator on a GitHub repo hits this in the order relay fails:

- `relay doctor` demands Atlassian and GitLab credentials they no longer have.
- Selection asks for a Jira project key from the **tracker doc**, which their doc does not carry.
- Even given credentials, the **frontier** query is JQL against a Jira instance that holds none of their issues.
- Every tracker-facing **role** is told to reach the tracker over the Atlassian MCP server, which is not where their issues live.
- The **handover** publishes to GitLab, so the one thing a **pass** exists to produce — a reviewable branch handed to a human — lands nowhere the team looks.

There is no partial-credit state here. relay is either speaking the team's tracker or it is unusable.

## Solution

relay speaks GitHub, and only GitHub.

An operator points relay at a GitHub repo whose issues live in that same repo, sets one token, and runs a **pass** exactly as before: relay picks the longest-waiting eligible **work item**, plans its **tickets** from the item's sub-issues, implements, reviews, fixes, runs the **green gate**, and hands over a pull request with the work item labelled for review.

From the operator's side the visible changes are:

- One credential instead of three.
- One tool — `gh` — used by relay on the host and by every **leg** in the **sandbox**, so debugging a pass means running the same commands relay ran.
- The **tracker doc** stops carrying setup constants: a repo owns its own issues, so relay reads the repo from the git remote.
- Work items and tickets are ordinary GitHub issues in a sub-issue tree, blocked by native issue dependencies, with lifecycle carried by labels — all of it visible in GitHub's UI without opening relay's docs.

Nothing named Jira or GitLab survives anywhere in the codebase.
There is no flag to get the old behaviour back, and no adapter layer between relay and GitHub.

## User Stories

### Running a pass

1. As an operator, I want to run relay against a GitHub repo with no Jira or GitLab setup at all, so that relay works on the tracker my team actually uses.
2. As an operator, I want relay to pick the longest-waiting eligible work item when I name none, so that I can run it without deciding what to work on.
3. As an operator, I want to name a work item as a bare number, so that I can type the fastest thing that identifies it.
4. As an operator, I want to name a work item as `#42`, so that pasting from a GitHub comment works.
5. As an operator, I want to name a work item as a full GitHub issue URL, so that pasting from my browser works.
6. As an operator, I want relay to tell me plainly when there is nothing to do, so that an empty frontier is not mistaken for a failure.
7. As an operator, I want the **pass branch** named after the work item's number, so that I can tell at a glance which issue a branch belongs to.
8. As an operator, I want relay to refuse to reuse an existing branch, so that a previous pass's work is never silently overwritten.

### Eligibility and the frontier

9. As a maintainer, I want relay to run only over issues I have labelled `ready-for-agent`, so that nothing starts on work I have not blessed.
10. As a maintainer, I want relay to skip an issue that is already **held**, so that two passes never race on the same item.
11. As a maintainer, I want relay to skip a closed issue, so that finished work is never re-run.
12. As a maintainer, I want relay to skip an issue with an **open blocker**, so that work never starts before its prerequisite is done.
13. As a maintainer, I want a *closed* blocker to be ignored, so that a finished dependency does not hold work back forever.
14. As a maintainer, I want a blocker in another repository to be honoured too, so that a cross-repo prerequisite is not silently dropped.
15. As a maintainer, I want relay to explain exactly which gate an explicitly-named item failed, so that I can fix the issue rather than guess.
16. As a maintainer, I want an explicitly-named item held to the same gates as an auto-picked one, so that naming an item is never a way to bypass a rule.
17. As a maintainer, I want the frontier scan to cost one API call regardless of backlog size, so that starting a pass stays fast as the backlog grows.
18. As a maintainer, I want the frontier ordered longest-waiting first, so that applying `ready-for-agent` is how I steer what runs next.

### Lifecycle a human can see

19. As a maintainer, I want the planner to label a work item `agent-in-progress`, so that I can see an agent has taken it.
20. As a maintainer, I want that label applied idempotently, so that re-running after a crash is not an error.
21. As a maintainer, I want a successful pass to leave the item labelled `agent-in-review`, so that I know it is waiting on me.
22. As a maintainer, I want a blocked pass to leave the item labelled `agent-blocked`, so that I can find work that needs a human decision.
23. As a maintainer, I want relay never to close an issue, so that closing stays a human act tied to a merge.
24. As a maintainer, I want a crashed pass to leave the item held and commented, so that I find out what happened without reading logs.
25. As a maintainer, I want relay to read no per-repo tracker ids — no project id, no field id, no transition id — so that setting a repo up cannot go wrong in a way relay must debug.

### Planning from the issue graph

26. As a maintainer, I want the planner to treat a work item's sub-issues as its tickets, so that the plan is the breakdown I already wrote in GitHub.
27. As a maintainer, I want a work item with no sub-issues to run as its own single ticket, so that small work needs no ceremony.
28. As a maintainer, I want tickets ordered so each comes after the tickets blocking it, so that dependencies between my tickets are respected.
29. As a maintainer, I want already-closed sub-issues left out of the plan, so that a resumed effort does not redo finished work.
30. As a maintainer, I want the planner to invent no tickets, so that plurality only ever comes from a breakdown a human wrote.
31. As a maintainer, I want the planner to bail when a ticket does not convey enough to implement, so that relay never fabricates its way through an under-specified item.
32. As a maintainer, I want an epic-shaped item to be the ordinary multi-ticket case rather than a rejected type, so that the breakdowns I already write are what relay runs on.

### Handover

33. As a maintainer, I want a successful pass to open a pull request, so that the work reaches me where I review.
34. As a maintainer, I want a mid-block pass with committed work to open a **draft** pull request, so that partial work is not lost with the sandbox.
35. As a maintainer, I want a mid-block pass with an empty branch to open no pull request, so that I am not handed noise.
36. As a maintainer, I want an early-bail pass to open no pull request, so that a refusal to start does not look like work.
37. As a maintainer, I want the pull request to close the ticket issues it implemented when I merge it, so that finished tickets close themselves.
38. As a maintainer, I want relay never to write a closing keyword against a parent issue, so that a work item is never marked done while its children are open.
39. As a maintainer, I want the work item commented with the pull request URL and one line on what was built, so that the issue tells the story without opening the branch.
40. As an operator, I want a terminal report naming the outcome, the item's state, the branch, the pull request, each committed ticket with its short SHA, and the green gate's verdict, so that I know where things stand without opening GitHub.
41. As a maintainer, I want relay to hold the handover to the pull-request rule relay computed, so that a leg cannot quietly skip publishing or publish an empty branch.

### Credentials and setup

42. As an operator, I want to set one GitHub token instead of an Atlassian pair plus a GitLab token, so that setting up a machine is a single step.
43. As an operator, I want every missing credential reported in one error, so that I fix my whole setup in one go.
44. As an operator, I want environment variables to override the credential file, so that CI and one-off runs need no file.
45. As an operator, I want the token never written to the sandbox's disk, so that a token cannot leak through a stray image layer or artefact.
46. As an operator, I want `relay doctor` to check that `gh` is installed and authenticated on my host, so that I learn about a missing tool before a pass starts.
47. As an operator, I want `relay doctor` to report every failing check rather than the first, so that I see my whole setup at once.
48. As an operator, I want a leftover `jira` block in my repo config to fail loudly with a clear message, so that migrating a repo cannot half-succeed.
49. As an operator, I want relay to check `gh` inside the sandbox before the first leg runs, so that a stale image fails in seconds instead of forty minutes in at the handover.
50. As an operator, I want a per-repo migration checklist, so that I can convert a target repo without reverse-engineering relay.

### Safety

51. As a maintainer, I want relay to write dependency edges only in the way that cannot link the wrong issue, so that relay can never silently create an edge to a stranger's issue in an unrelated repository.
52. As a maintainer, I want relay to filter open blockers itself rather than trusting a blocked-by count, so that a closed blocker cannot keep work permanently ineligible.
53. As a contributor, I want no Jira or GitLab vocabulary left in the codebase, so that I never have to work out whether a mention is dead or load-bearing.
54. As a contributor, I want the glossary, the ADRs and the code to agree, so that the documented model is the real one.

## Implementation Decisions

### The tracker client module

The Jira client module is replaced by a GitHub one; `JiraClient`, `JiraIssue`, `JiraBlocker`, `JiraCredentials` and `JiraError` are renamed to their GitHub equivalents, and the module keeps its role as *the host's read-and-comment slice* — deliberately small enough to fake.

Its interface keeps three operations, in the same shape as today:

- list the **frontier** — this repo's open issues labelled `ready-for-agent`, longest-waiting first;
- get one issue by number, returning `undefined` when it is not visible, since "no such issue" is an answer and not a failure;
- comment on an issue.

The issue record it returns carries only what the **eligibility check** and the planner gate on: number, state, labels, and blocked-by entries *with their state*. Issue type is gone; the key/`projectKey` prefix check is gone.

**The client shells out to `gh`.** It takes an injected runner — a function from an argument list to stdout — defaulting to the real one, mirroring how the docker host module exports both a `DockerRunner` type and a real `runDocker`. There is no REST client and no `fetch`.

Two `gh` facts the implementation depends on, both verified:

- The frontier is **one** call. Listing issues with the `blockedBy` and `subIssues` JSON fields resolves the real edges for a whole page in a single GraphQL request, so there is no per-issue follow-up and no use for the REST dependency summary.
- `gh` requests exactly the documented page sizes for those nested fields, so relay does not paginate them.

Two shape details to handle explicitly:

- Those nested nodes report state as `"OPEN"`/`"CLOSED"` in upper case, unlike REST's lower case.
- The `repository` field `gh` requests on them never appears in output, so a **cross-repo blocker is identified from its `url`**.

### Writing to the tracker

- **Labels** are the lifecycle, applied and removed idempotently. No transitions, no status field, no per-project ids.
- **Dependency edges are written only through `gh issue edit --add-blocked-by`.** relay must never call the REST `dependencies/blocked_by` endpoint: it takes a numeric database id, and passing an issue *number* returns `201` while linking an unrelated repository's issue. This is a hard rule with a test asserting the absence.
- relay never closes an issue.

### Work-item selection

The frontier query and the eligibility check keep their current division of labour — the query is a prefilter, and one eligibility function decides both the auto-pick and an explicitly-named item, so the two can never disagree.

The gates become: labelled `ready-for-agent`; not labelled `agent-in-progress` (**held**); state open; no **open blocker**.
Runnable-type and repo-label gates are deleted outright.

**Open-blocker filtering is relay's own**, and lives in the eligibility check rather than in the client's mapping — the client reports blockers with their state, eligibility filters for open. A count of blocked-by edges must never be trusted, because GitHub's includes closed ones.

### Scope resolution

`TrackerScope` and the tracker doc's setup-constant parser are both deleted.
`gh` infers the repo from the clone's remote.

The tracker-doc module keeps only the doc's path and an existence check — every tracker-facing role is told to read that doc first, so a missing one still fails the pass early with a clear error.

The repo config schema loses its `jira` block with nothing replacing it: github.com is assumed. Because the schema is strict, a leftover `jira` block fails loudly on its own, which is the migration error operators need.

### Work-item identity

A work item is a bare issue number.
The CLI normalises `42`, `#42` and a full issue URL to the number.
The **pass branch** is the branch prefix plus the number, with no title slug.

`WORK_ITEM_KEY` becomes `WORK_ITEM` in every prompt, and the word "key" leaves the vocabulary.

### The sandbox

The Atlassian MCP config generation, its temp directory, its bind mount and its teardown are all **deleted** from the sandbox module — this is the largest single subtraction in the change.

The sandbox environment carries one GitHub token as `GH_TOKEN` (not `GITHUB_TOKEN`: `gh` prefers it, and it cannot collide with the variable GitHub Actions injects), plus the Claude credential as today. The token reaches the sandbox as an environment variable and is never written to its disk.

Before the first **leg**, relay runs a `gh` version check inside the sandbox. A sandbox image without `gh` fails there, in seconds.

### Secrets

`Secrets` collapses to a GitHub token plus the Claude credential; the Atlassian pair and the GitLab token are gone. Claude credential resolution is untouched.
The home-dir file, the environment-variable precedence, and the single aggregated error all stay exactly as they are.

Required token permissions, for the migration checklist: `Issues: write` (which covers sub-issues, dependencies, issues and labels alike), `Pull requests: write`, `Contents: write`, `Metadata: read`.

### Role prompts

- **Planner** — reads the tracker doc first, ensures the work item is labelled `agent-in-progress`, then finds the item's **sub-issues** as its tickets and orders them by their dependency edges, leaving closed ones out. Sub-issues are sorted by number, because their order is undocumented and empirically insertion order. The issue-type-mapping paragraph is deleted; the "ensure, do not set" discipline and the bail-rather-than-fabricate rule are kept.
- **Handover** — publishes with `gh pr create` directly, with `--draft` inline for a mid-block, dropping both the `kipu-all:kipu-mr` delegation and the separate draft-conversion command. It writes `Closes #<ticket>` for each ticket the pass committed and **never** a closing keyword against the work item when that item is a parent. It swaps the `agent-in-progress` label for `agent-in-review` or `agent-blocked`, comments the outcome, and writes no code.
- Every prompt's tracker vocabulary becomes GitHub's, and the merge-request wording becomes pull-request throughout.

### Handover harness contract

The handover leg still publishes — the harness does not. Only the leg knows what belongs in the pull-request body, and legs doing the work while the harness judges is the established shape.

The reported URL field and the rule enforcing it are renamed from merge request to pull request; the three-way rule itself (required on success, required on a mid-block with commits, forbidden otherwise) is unchanged.

### Doctor

A `gh` check joins the preflight: installed, and authenticated. It follows the existing pattern of reporting every check rather than failing on the first.

### Target-repo migration checklist

Shipped as part of this change, since target repos cannot migrate by guessing:

- replace the repo's agent-facing issue-tracker doc with the GitHub one;
- install `gh` in place of `glab` in the repo's sandbox Dockerfile;
- delete the `jira` block from the repo config;
- ensure the repo's issues carry the `ready-for-agent` label vocabulary, and that `agent-in-progress`, `agent-in-review` and `agent-blocked` exist as labels.

## Testing Decisions

A good test here asserts external behaviour: given these issues, does relay pick this one; given this outcome, does the handover get told a pull request is required. It never asserts on private helpers, call order for its own sake, or the wording of a prompt beyond the facts a leg is judged on.

Three seams, mirroring the three that exist today.

**1. The GitHub client interface — the high seam, faked.**
Selection and pass tests fake the whole client, exactly as the current work-item tests fake Jira with an in-memory issue list that also records the queries it was asked. Every eligibility rule is tested here, with no network and no sandbox:

- the `ready-for-agent` gate, the `agent-in-progress` hold, closed state, and an open blocker;
- a **closed** blocker being ignored;
- a blocker in **another repository** being honoured, identified from its `url`;
- an auto-pick over an empty frontier returning nothing-to-do;
- an explicitly-named item failing each gate with a reason naming that gate;
- longest-waiting ordering.

Prior art: the current work-item tests, and the pass tests' two injected seams.

**2. The `gh` runner — injected into the client.**
The client's own tests fake the runner, assert on the argument lists, and answer with canned `gh` JSON. This is where the API-shape obligations are pinned:

- the frontier is **one** runner call, with the `--json` field list naming the real fields;
- upper-case `"OPEN"`/`"CLOSED"` in nested nodes is mapped correctly;
- a blocked-by entry with no `repository` field is still attributed via its `url`;
- a dependency edge is written with `gh issue edit --add-blocked-by`, and **no** test-visible call ever targets a `dependencies` REST endpoint — asserted as an absence, because the failure mode is silent success;
- a "no such issue" answer yields `undefined` rather than throwing;
- a `gh` failure becomes the module's own error type.

Prior art: the doctor tests' faked `DockerRunner`, and the current Jira client tests' queued-response stub — same technique, an injected function instead of a stubbed global.

**3. `Sandbox.run` — unchanged.**
Role tests keep stubbing the sandbox's run, asserting on the prompt arguments a leg is given and parsing its tagged block from canned stdout. Covers:

- the handover being told the pull-request verdict, and the harness rejecting a leg that ignores it in either direction;
- the in-sandbox `gh` version preflight failing the pass before the first leg;
- the sandbox environment carrying `GH_TOKEN` and no Atlassian or GitLab variable, and no MCP config being mounted.

Prior art: the current handover tests.

Also updated, not newly designed: the secrets tests (one token, aggregated error, precedence), the config tests (no `jira` block; a leftover one rejected by the strict schema), and the tracker-doc tests (path and existence only, no setup constants).

The whole suite must pass `npm run verify`, which is this repo's green gate.

## Out of Scope

- **relay's own CI and release** — the GitLab CI file, the GitLab semantic-release plugin, and npm trusted publishing pointed at the GitLab project. Independently landable, and mechanical next to the forge seam.
- **The `kipu-all` plugin skills** — `kipu-mr`, `kipu-release-mr` and `triage-dependency-bumps` are all `glab`-based and live in another repo. This change removes relay's dependency on `kipu-mr` rather than porting it.
- **relay's own issue tracker.** This repo keeps its local-markdown tracker; moving relay's own issues to GitHub is a separate effort from teaching relay to speak GitHub.
- **GitHub Enterprise Server.** No host knob, and issue dependencies are not available there anyway.
- **GitHub Projects v2.** Ruled out in ADR-0008; no board, no status field, no rank.
- **Priority.** Deliberately lost, not deferred with a placeholder.
- **relay closing a work item.** relay stops at the handover by design and does not observe the merge.
- **A relay-owned sandbox base image.** Target repos keep owning their Dockerfile; relay only checks `gh` is there.

## Further Notes

**This is a hard switch.** There is no dual support, no adapter, no flag. A repo on Jira or GitLab cannot run relay after this change, which is the intended and stated cost (ADR-0007).

**Two obligations GitHub will not enforce**, and both fail silently if they regress — they deserve the most careful tests in the change:

- filtering blockers for open state, because a blocked-by count includes closed blockers;
- never writing a closing keyword against a parent issue, because GitHub neither refuses nor warns — a probe closed a parent with two open sub-issues and left it marked `completed` with `0 of 2`.

**The glossary is already updated** and currently runs ahead of the code: **Frontier**, **Ticket**, **Eligibility check**, **Open blocker** and **Tracker doc** describe GitHub, and **Held** is a new term. Implementation should make the code match the glossary, not the reverse. ADR-0007 and ADR-0008 are accepted, and ADR-0002 and ADR-0005 have been amended.

**Expect this change to be net-subtractive.** The Atlassian MCP machinery, `TrackerScope`, the setup-constant parser, `RUNNABLE_TYPES`, issue types, the priority ordering and one credential pair all go. A diff that adds more than it removes is a signal something was ported that should have been deleted.
