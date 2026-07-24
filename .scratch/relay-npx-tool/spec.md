# Spec: relay — one-pass autonomous work-item runner (npx tool)

Status: ready-for-agent

Source map: `.scratch/relay-npx-tool/map.md` (13 resolved wayfinder tickets). This spec is the locked synthesis; the map's per-ticket files hold the deeper rationale.

## Problem Statement

A developer has a backlog of ready Jira work items and wants an autonomous agent to take one of them from "ready" to "reviewable" without babysitting it — plan, implement under test, review, fix, quality-gate, and open a merge request — then stop and hand the work back to a human.

Today the closest tool (`kipu-afk`) runs its whole crew inside one umbrella agent with inline review rubrics, which prevents each role from being a real, spawnable subagent and blurs responsibility.
A throwaway per-repo spike (`sandcastle_qc-catalog`) proved the pieces work but is Task-level, single-implement, poll-loop, and not distributable.
The developer needs a single distributable tool, installed and run per repo, that does exactly one honest pass over exactly one work item, with each role as a first-class subagent, and hands off cleanly.

## Solution

`relay` is a published npx tool (`@quantum-hub/relay`) that runs **one** pass over **one** Jira work item, then hands the baton to a human.

From the developer's perspective:

- They run `npx @quantum-hub/relay` in a repo that has committed a `relay.config.ts` and a `docs/agents/issue-tracker.md`. With no argument, relay picks the next `ready-for-agent` Story / Bug / Vulnerability for that repo. With a work-item key argument, relay runs that item.
- relay opens a branch and worktree inside a local Docker sandbox that mirrors the repo's CI environment, then orchestrates a crew of focused subagents — planner, per-ticket implementer (TDD), fast code + spec review, fixer, whole-branch in-depth code + spec review, fixer, quality-gate, fixer — with the TypeScript harness itself as the orchestrator.
- When the work reaches a reviewable state, relay pushes the branch, opens a GitLab merge request, moves the Jira item to In Review, comments a human-readable report, and exits 0. If the work is blocked mid-pass it opens a Draft MR, labels the item `agent-blocked`, and exits 1. If the item is under-specified it bails to a human with no MR and exits 1. Config / auth / infra / wrong-type errors exit 2.
- The pass always ends. There is no resume, no paused state, no runaway loop. A human is the recovery path.

The pilot target is **qc-catalog** (Java 21 / Maven). Generalization to other repos and languages is a later effort.

## User Stories

### Invocation & selection

1. As a developer, I want to run `relay` with no argument, so that relay auto-picks the next ready work item for this repo and I don't have to look one up.
2. As a developer, I want auto-pick restricted to Story / Bug / Vulnerability issue types, so that a Task is never silently picked up as autonomous work.
3. As a developer, I want auto-pick ordered by priority (highest first), then oldest-created first, so that the most important, longest-waiting item runs.
4. As a developer, I want to pass an explicit work-item key, so that I can direct relay at a specific item regardless of the frontier.
5. As a developer, I want an explicitly-passed Task to exit with an error, so that relay never attempts a work type it isn't meant to run.
6. As a developer, I want an explicit key held to the same eligibility gates as auto-pick (with no override), so that behavior is consistent and any gate failure breaks the pass loudly.
7. As a developer, I want the repo scope (which items belong to this repo) sourced from `docs/agents/issue-tracker.md` rather than inferred from the git remote, so that selection is explicit and configurable.
8. As a developer, I want relay to run `relay doctor` as a full opt-in preflight check, so that I can validate my config, secrets, and environment before trusting a real run.

### The pass — planning

9. As a developer, I want a planner subagent to verify and order the pre-existing tickets for the work item, so that implementation follows a sound dependency order.
10. As a developer, I want the planner to never author new slices or decompose work on the fly, so that relay only builds what humans already specified.
11. As a developer, I want a work item with related tickets planned in dependency order, and a work item with none treated as a singleton, so that both shapes flow through the same per-ticket loop.
12. As a developer, I want the planner to ensure the item is In Progress (idempotently), so that re-running after a crash doesn't fail on an already-transitioned item.
13. As a developer, I want an under-specified ticket to bail to a human rather than be fabricated into a guess, so that I never get invented scope.

### The pass — per-ticket implementation

14. As a developer, I want each ticket implemented by a fresh implementer subagent under TDD, so that every ticket gets test-first, focused work in a clean session.
15. As a developer, I want the implementer to use a custom prompt derived from the lean `implement` method (minus its review line), so that review is a separate role, not folded into implementation.
16. As a developer, I want the implementer to self-commit its ticket, so that progress is captured in git without a separate commit role.
17. As a developer, I want a fast code review and a fast spec review to run concurrently on each ticket, so that both maintainability and spec-compliance are checked quickly per ticket.
18. As a developer, I want a fixer to address the per-ticket review findings, so that issues are resolved before moving to the next ticket.
19. As a developer, I want tickets processed sequentially on one branch in one sandbox, so that the work forms a single coherent chain.

### The pass — whole-branch review & gate

20. As a developer, I want a whole-branch in-depth code review and spec review to run once (concurrently) after all tickets, so that the branch is checked as a whole, not just per ticket.
21. As a developer, I want a fixer to address whole-branch review findings once, so that cross-ticket issues are resolved.
22. As a developer, I want a quality-gate role that runs the repo's green-gate command and triages the result, so that the branch is verified against real tests.
23. As a developer, I want the quality-gate → fixer loop capped at 2 iterations, so that relay converges or gives up rather than looping forever.
24. As a developer, I want subjective review roles to run once (not loop) and only the objective gate to loop, so that relay loops only where a machine-checkable signal exists.
25. As a developer, I want the final green gate to run all test tiers except e2e (including migration and integration), so that the reviewable branch is genuinely verified.

### The pass — orchestration model

26. As a developer, I want the TypeScript harness to own the orchestration loop, so that each role is a real spawnable subagent rather than an inline rubric inside one umbrella agent.
27. As a developer, I want each role to run as a separate sandbox run in its own cold session, sharing only files and git, so that roles stay focused and independent.
28. As a developer, I want the two review lenses to run concurrently as read-only roles, so that reviews are fast and can't interfere with each other.
29. As a developer, I want findings passed between roles via per-role status/findings files and branch commits, so that handoff is inspectable and file-based.
30. As a developer, I want the harness to array-merge findings and the fixer to dedup them, so that overlapping findings from concurrent reviewers are handled cleanly.

### Handover & outcomes

31. As a developer, I want a successful pass to push the branch and open a GitLab MR via the MR skill, so that the work lands in code review.
32. As a developer, I want success to move the item to In Review (never Done), add a resolution comment, and produce a human-readable report, exiting 0, so that a human reviews before anything is called finished.
33. As a developer, I want nothing-to-do to fold into a clean exit 0, so that an empty frontier isn't an error.
34. As a developer, I want a mid-pass block to open a Draft MR, label the item `agent-blocked` with a comment, and exit 1, so that partial work is visible and marked.
35. As a developer, I want an early under-spec bail to skip the MR, label `agent-blocked` with a comment, and exit 1, so that I know a human needs to clarify.
36. As a developer, I want config / auth / infra / wrong-type errors to exit 2, so that I can distinguish operational failure from a blocked pass.

### Failure & recovery

37. As a developer, I want every pass to be a clean restart with no cross-pass state, so that recovery is simply re-running after a human fixes the blocker.
38. As a developer, I want a branch collision to refuse and exit 2 (never deleting commits relay didn't create), so that relay never destroys existing work.
39. As a developer, I want a crash mid-pass to exit 2 with no MR, the item left In Progress, and a best-effort Jira failure comment, so that the failure is visible and the branch/commits remain for a human.
40. As a developer, I want the sandbox always disposed at the end of a pass, so that a crash never leaves a container running.
41. As a developer, I want "needs input" to never pause interactively (it collapses to the mid-block Draft-MR outcome), so that relay never hangs waiting on a human.

### Configuration & secrets

42. As a developer, I want the target repo to commit exactly the config files relay needs and nothing else, so that installing relay is minimal.
43. As a developer, I want `relay.config.ts` (typed, zod-validated) read by the TypeScript harness for the green-gate command, default branch, image ref, dockerfile path, and URL env-var defaults, so that harness behavior is repo-configurable without secrets.
44. As a developer, I want `docs/agents/issue-tracker.md` read by the in-sandbox agent for tracker access, repo label, relation model, and issue-type mapping, so that agent-facing tracker knowledge lives in one agent-facing file.
45. As a developer, I want the green gate expressed as an explicit command string that relay just runs and reads the exit code of, so that relay stays build-tool-agnostic.
46. As a developer, I want package defaults (branch prefix, 45m timeout, per-role model map) that I can override, so that I get sane behavior out of the box but can tune it.
47. As a developer, I want secrets read from a home-dir file (`~/.config/relay/.env`, env-var overridable) and never from the package, so that no credential ships in the distributable.
48. As a developer, I want a single service-account identity end to end, so that all Jira access uses one pinned, auditable identity.
49. As a developer, I want GitLab coordinates derived from the git remote (not configured), so that I don't duplicate what git already knows.
50. As a developer, I want a real run to do only cheap fail-fast validation (config parse + secrets, else exit 2) with deep failures surfaced lazily but still exit 2, so that a run starts fast but still fails cleanly.

### Sandbox & environment

51. As a developer, I want an optional prebuilt image ref in config to win when present, so that I can point at a staged image instead of building locally.
52. As a developer, I want relay to build the sandbox image from a configurable dockerfile path (default `docker/relay.Dockerfile`, never repo-root) when no image ref is given, so that the repo owns its CI-parity recipe.
53. As a developer, I want the image baked with JDK 21 + Maven, Node, native claude, glab, and the docker CLI, with UID/GID aligned, so that in-sandbox tooling matches CI and file ownership is correct.
54. As a developer, I want skills, Atlassian MCP config, and the docker socket runtime-mounted (not baked), so that credentials and skills stay out of the image and Testcontainers integration tests can reach a live daemon.

### Distribution

55. As a developer, I want relay published as one public npm package (`@quantum-hub/relay`, ESM, Node >= 20) with prompts and orchestration shipped as data files in `dist`, so that I can `npx` it without extra setup.
56. As a developer, I want a flagless CLI (`relay [WORK-ITEM]` or `relay doctor`), so that the interface is minimal and obvious.
57. As a developer, I want the compiled harness to load my authored `relay.config.ts` via a bundled TS loader, so that I write config in TypeScript without a build step of my own.
58. As a developer, I want relay built and published by GitLab CI using the kipu commons pipeline components, so that releases are automated and consistent with other kipu packages.
59. As a developer, I want publishing to use OIDC trusted publishing (no NPM token), so that no publish secret exists to leak.

### Skills

60. As a developer, I want relay to reuse the existing kipu skills (kipu-commit, kipu-code-review, kipu-spec-review, kipu-mr, tdd) as harness-dispatched subagent roles, so that relay inherits proven behavior rather than reimplementing it.
61. As a maintainer, I want relay to replace and sunset `kipu-afk` and `kipu-implement` when it goes live, so that there is one delivery tool, not two overlapping ones.

## Implementation Decisions

### Orchestration topology (ticket 07, 12)

- **The TypeScript harness owns the loop.** The planner runs one-shot (ensures In Progress, emits an ordered `Output.object` plan of ticket refs), then the harness iterates. The rejected alternative was a persistent-planner agent — it would rebuild kipu-afk's umbrella.
- **One sandbox / one branch / sequential tickets.** Each role is a separate `sandbox.run` with its own cold session, sharing only files and git.
- **Per ticket:** implementer (custom prompt = `implement` method minus review line; self-commits via kipu-commit) → fast code review ∥ fast spec review (concurrent, read-only) → fixer.
- **Whole branch, once:** in-depth code review ∥ spec review (concurrent) → fixer.
- **Then:** quality-gate (runs green-gate command, triages) → fixer, looped with a **cap of 2**.
- **No dedicated commit role** — commit folds into implementer/fixer.
- **Reviews run once** (subjective); **only the gate loops** (objective). The harness array-merges findings from concurrent reviewers; the fixer dedups.
- **Handoff** = per-role status files under an output dir + findings files + branch commits.

### Work-item selection & planner (ticket 03)

- Planner is **config-driven** off `docs/agents/issue-tracker.md` (tracker access, repo label, relation model, issue-type mapping; repo scope from the file, not the git remote).
- Planner **verifies-and-orders pre-existing tickets; never authors slices.** On-the-fly decomposition rejected.
- **Auto-pick** = frontier JQL narrowed to `issuetype in (Story, Bug, Vulnerability)`, ordered priority DESC / created ASC, first wins. The type guard **inverts the spike's child-count guard**.
- **Explicit key** = same gates, no override; any failure breaks the pass.
- **Plan** = ephemeral `Output.object` list of ticket refs: has-related-tickets → those in dependency order; none → singleton. Handed to the per-ticket loop.
- Under-specified ticket ⇒ bail-to-human, never fabricate.
- Planner **ensures** (not merely sets) In Progress — idempotent, tolerates re-run after crash.

### Handover endpoint & exit codes (ticket 05, 12)

- **Success:** push + open GitLab MR via kipu-mr → item **In Review** (never Done) + resolution comment + human-readable report → **exit 0**. Nothing-to-do folds into exit 0.
- **Mid-block:** Draft MR + `agent-blocked` label/comment → **exit 1**.
- **Early bail (under-spec):** no MR + `agent-blocked` label/comment → **exit 1**.
- **Error (Task-as-param / config / auth / infra / crash / branch-collision):** **exit 2**.
- **Crash mid-pass:** exit 2, no MR, item left In Progress, best-effort Jira failure comment, **sandbox always disposed**.
- **Branch collision:** refuse, exit 2 — never delete commits relay didn't create.
- **Needs-input never pauses** — collapses to the mid-block outcome. No interactive/paused state exists.

### Credentials & secrets (ticket 04, 13)

- **Split responsibility:** the host picks the one work-item key via a TypeScript Jira REST call; the in-sandbox planner (and the spec-review roles) do all other Jira read/write/transition via the Atlassian MCP.
- **Single service-account identity** end to end: host REST basic-auth + sandbox MCP bearer, pinned cloudId, Jira-only, English locale (per ADR-0004). Operator identity is unused.
- **Secrets in a home-dir file** (`~/.config/relay/.env`, env-var override), none in the package: SA Jira token + `GITLAB_TOKEN` + Claude creds. Non-secret ids (cloudId, project key, repo label) live in `issue-tracker.md`.
- The SA Jira token **enters the sandbox** as the MCP bearer (reverses the spike's no-token-in-sandbox stance), injected via the mounted MCP config.
- Jira **read** extends to the spec-review roles (same SA bearer, no new secret); **writes/transitions** stay with planner + handover.

### Configuration surface (ticket 06, 08)

- Config **splits two files by reader**:
  - `relay.config.ts` (repo root, typed/zod, read by the TS harness): green-gate command, default branch, image ref, dockerfile path, URL env-var defaults. No secrets — resolved from `~/.config/relay/.env` / env per ticket 04.
  - `docs/agents/issue-tracker.md` (read by the in-sandbox agent): tracker access, repo label, relation model, issue-type mapping.
- **Green gate = explicit command string**; relay is build-tool-agnostic (runs it, reads exit code). **Final gate = all tests except e2e** (migration + integration are IN — the image must run those tiers).
- **Package defaults (overridable):** branch prefix / 45m timeout / **per-role model map** — implementer + fixer + MR: sonnet (escalating to opus); fast review: opus; in-depth review: fable; quality-gate: sonnet; planner: opus. (Deltas vs. kipu-afk map: no `commit` role; quality-gate haiku→sonnet.)
- **No GitLab coordinates** — glab / kipu-mr derive from the remote.
- **Validation:** a `relay doctor` command (full opt-in check, including a docker-socket check per ticket 09). A real run does cheap fail-fast only (config parse + secrets → exit 2); deep failures are lazy but still exit 2.

### Docker sandbox image (ticket 09)

- **Prebuilt-ref-wins:** an optional `image` ref in `relay.config.ts` (future staged images) is used when present; otherwise relay **builds** from a configurable `dockerfile` path (default `docker/relay.Dockerfile`, **never repo-root** — the repo owns the CI-parity recipe; the third committed file exists only in the build-locally case).
- **Baked:** JDK 21 + Maven, Node, native claude, glab, **docker CLI**; UID/GID aligned.
- **Runtime-mounted:** skills; **Atlassian MCP config** (remote HTTP — nothing baked, carries the SA bearer); **`/var/run/docker.sock`** (docker-outside-of-Docker) — because the final gate runs qc-catalog's **Testcontainers** integration tier, which needs a live daemon (sibling containers, safe under the one-sandbox/sequential model).
- **Load-bearing build risk (no ticket, first de-risking spike):** socket mount + Testcontainers-green inside a sandcastle `docker()` sandbox is **unproven** (the spike ran unit-only). `relay doctor` gains a socket check.

### Skills delivery & invocation (ticket 01, 11)

- Skills reach the headless in-sandbox subagents **only via bind-mount into `~/.claude/skills/<name>`**.
- Spike 11 **proved all three invocation paths work headless** (claude 2.1.218): capability (auto-fires as the `Skill` tool from a plain prompt), slash expansion (`-p "/name args"` expands client-side), and by-name. This **relaxes ticket 01's original "never slash" rule.**
- **Caveat:** only *personal* artifacts were tested; *plugin* marketplace skills (the real kipu-* skills) under `-p` are **not yet verified** — the build must confirm.
- Mount set: kipu-code-review, kipu-spec-review, kipu-commit (+ caveman-commit), **tdd**; the implementer inlines the `implement` method. Each spec-review `sandbox.run` needs the Atlassian MCP wired. Runtime mount set also includes the MCP config and the docker socket.

### Review-role brief source (ticket 13)

- **Spec-review** roles fetch their intent (ticket brief / spec + ticket list) **from the tracker per `issue-tracker.md` by key** (not a planner-written file handoff) — the tracker stays the single source of truth. kipu-afk's `.kipu/` file convention is dropped. `kipu-code-review` needs no fetch.

### Packaging & distribution (ticket 02, 08, 10)

- The `sandcastle` CLI only bootstraps (`init` + `docker build-image`); it has no `run`. relay is **our own TS orchestration on the library API** (`run` / `createSandbox` / `claudeCode` / `Output.object` / `branchStrategy: branch`). Jira is not built-in — ours to wire. Pin the pre-1.0 sandcastle version; add zod; UID-matched image.
- **One published package** (`@quantum-hub/relay`): compiled `dist` (ESM via `tsup`); prompts + orchestration ship as **data files in `dist`** resolved via `import.meta.url`.
- **Target repo commits exactly two files** (`relay.config.ts` + `issue-tracker.md`) in the prebuilt-ref case; the build-locally case adds the third (dockerfile). Everything else is carried.
- **Flagless CLI** (`[WORK-ITEM]` | `doctor`). The compiled-JS harness loads the authored `relay.config.ts` via a bundled **`jiti` / `bundle-require`** loader (revises "TS reads TS").
- **Manifest:** exact-pinned sandcastle + zod + jiti; ESM; Node `>=20`; `files: ["dist"]`; no host `claude` dependency; `publishConfig.access: public`; Apache-2.0 `LICENSE` in `files`.
- **Publish public npmjs**, **auth = OIDC trusted publishing, no `NPM_TOKEN`**.
- **CI** (`.gitlab-ci.yml` = qhub-api's minus the python/typescript split; single package at root):
  - Branch: `compile-typescript` (ci → lint → test → build) + `oss-compliance-check@v1.6.3` (FOSSA).
  - main: `semantic-release` (bumps `package.json`, `chore(release)` commit, cuts tag) using `@semantic-release/npm` with `npmPublish:false` (bump only).
  - Tag: `oss-compliance-check` again as the gate (first rule `$CI_COMMIT_TAG`; `fossa test` fails before publish) → `publish-npm` (build + `npm publish`).
  - All jobs `tags: [kubernetes, cluster]`.
  - **Setup prereqs:** configure the npmjs trusted-publisher for `@quantum-hub/relay` → this project before the first tag; verify `node:lts` npm >= 11.5 for OIDC (else override `image`).
  - `package.json` gains `lint` / `test` / `build` scripts; commit root `package-lock.json`.

### Sunset (map / ticket 07)

- relay **replaces** kipu-afk and kipu-implement when live — it is their replacement, not a consumer. kipu-afk is the *reference flow* only; the implementer uses a custom prompt from the leaner `implement` method, not `kipu-implement`.

## Testing Decisions

A good test here asserts **external behavior at a seam** — exit codes, Jira side-effects, MR outcomes, loop sequencing, config validation — never the internal wording of a role prompt or the internal shape of a helper. Agent/prompt behavior and real claude-in-docker runs are integration/e2e territory and are deliberately **not** in the harness's own final gate.

Three injectable seams sit beneath the CLI process boundary (a single CLI-process seam would be one true entry point but is too expensive to drive the loop through):

1. **Jira client interface (Seam 1 — pure).** Work-item selection + type guard (ticket 03) against a fake Jira client. Assert: auto-pick JQL narrowed to Story / Bug / Vulnerability; Task-as-param rejected (exit 2); priority DESC / created ASC ordering; explicit-key held to the same gates; under-spec bail. No sandbox, no network.

2. **Orchestration harness loop (Seam 2 — topology).** The harness loop (tickets 07, 12) with `sandbox.run` stubbed per role + a fake Jira client. Assert: planner-then-iterate; sequential tickets; concurrent review lenses; gate → fixer loop capped at 2; exit-code mapping (0 / 1 / 2); crash → exit 2 + item left In Progress + sandbox disposed; branch collision → refuse, exit 2; findings array-merge + dedup. This is where failure/recovery semantics are proven.

3. **Config + doctor (Seam 3 — edges).** `relay.config.ts` load via jiti + zod (tickets 06, 08): parse, validate, fail-fast exit 2 on bad config / missing secrets. `relay doctor` checks including the docker-socket check (ticket 09).

**Modules tested:** the selection/type-guard module (Seam 1), the orchestration harness (Seam 2), the config loader + doctor (Seam 3).

**Prior art:** the throwaway `sandcastle_qc-catalog` spike and the sandcastle author's example workflows (`course-video-manager/.sandcastle/`: `run-with-retry`, `run-with-extraction`, `review/`, `update-branch/`) are structural references for how roles and extraction are wired — mine them for the fake-run and findings-extraction test shapes.

**Not unit-tested (integration / e2e, out of the final gate):** real agent/prompt behavior; docker + Testcontainers + socket green inside a sandcastle `docker()` sandbox. The socket + Testcontainers-green proof is the build's **first de-risking spike** (ticket 09), not a spec test.

## Out of Scope

- Generalizing beyond the Java/Maven qc-catalog pilot to the other ~15 repos / Python / TypeScript repo types — a later effort once the pilot works.
- The outer scheduling / poll loop that runs the tool repeatedly — relay does one pass; the loop is established later.
- A machine-readable JSON run summary for that outer loop — deferred with the loop (the loop effort will want structured output beyond the exit code).
- Driving a remote GitLab-MR CI pipeline from red to green (the spike's `ci-fix` loop) — the pass ends at the local quality gate + human handover.
- Building the tool itself — this spec is plan-only; it hands off to a build effort.

## Further Notes

- **Build base — rebuild from scratch:** relay is built on the Sandcastle author's more sophisticated templates + examples (`@ai-hero/sandcastle` local checkout + `course-video-manager/.sandcastle/` + `matchplaytime`). The qc-catalog spike is **reference/prototype only, never a base**.
- **Recommended build approach:** bootstrap via the `sandcastle` CLI (`init` + `docker build-image`), then build up from the author's example workflows on the library API.
- **Locked context, not open questions:** ADRs at `kipu/skills/docs/adr/` — 0003 (afk story orchestration), 0004 (poll-claim harness contract + headless Atlassian MCP auth proven), 0005/0006 (per-ticket vs story model), 0007/0008 (review-lens split). The publish reference is `qhub-api/.gitlab-ci.yml`.
- **First de-risking spike for the build:** docker socket mount + Testcontainers-green inside a sandcastle `docker()` sandbox (unproven; the spike ran unit-only).
- **Second thing the build must confirm:** plugin (marketplace) skills under `-p` — spike 11 proved only personal artifacts.
- Every build session should consult the prior-art sources above.
