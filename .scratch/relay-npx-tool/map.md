<!-- wayfinder:map -->

# Map: relay npx tool

## Destination

A locked spec + resolved decisions for `@quantum-hub/relay` — a distributable npx tool (built + published via GitLab CI kipu commons components) that runs **one** pass over **one** Jira work item and hands off to a human.

- Input: a work-item key, or — with no param — the next `ready-for-agent` **Story / Bug / Vulnerability** for the current repo. A **Task** is never auto-picked; a Task passed as param exits with `error`.
- The pass is orchestrated as **Sandcastle-dispatched proper subagents per role** (planner, per-ticket implementer under TDD, per-ticket fast code + spec review, fixer, whole-branch in-depth code + spec review, fixer, quality-gate, commit) — the harness is the orchestrator, not one umbrella `kipu-afk` agent.
- Runs on a branch + worktree in a local Docker sandbox.
- Pilot target: **qc-catalog** (Java 21 / Maven). One repo first.

Plan only: this map produces the spec + decisions, then hands off to a build effort. It does not build the tool.

## Notes

**Build base — rebuild from scratch on the author's work:**

- The tool is built from the **Sandcastle author's more sophisticated templates + examples**: `@ai-hero/sandcastle` (local `/Users/michael.wurster/work/sandbox/sandcastle`, its own `.sandcastle/`) and `/Users/michael.wurster/work/sandbox/course-video-manager/.sandcastle/` (rich `agent-workflows/`, `run-with-retry`, `run-with-extraction`, `review/`, `update-branch/`), plus `matchplaytime`. These are the structural base.

**Prior art — reference for decisions only, NOT a codebase to extend:**

- The qc-catalog spike: `/Users/michael.wurster/work/sandbox/sandcastle_qc-catalog/.sandcastle/` — a working but throwaway per-repo prototype (host-owns-Jira poll loop, Docker CI-parity image, green-gate, credential model, glab MR). It is **Task-level, single-implement, poll-loop**. Use it to learn what worked and what didn't (e.g. the headless skill-expansion finding) — do **not** build on it.
- ADRs at `/Users/michael.wurster/work/kipu/skills/docs/adr/` — 0003 (afk story orchestration), 0004 (Sandcastle poll-claim harness contract + **headless Atlassian MCP auth proven**), 0005/0006 (per-ticket vs story model), 0007/0008 (review lens split). Treat these as locked context, not open questions.
- Publish reference: `/Users/michael.wurster/work/kipu/qhub-api/.gitlab-ci.yml` uses `gitlab.com/kipu-all/commons/pipeline-components/{compile-typescript,publish-npm,semantic-release}`.

**Skills the build will use (extracted into harness-dispatched subagents, not run as one umbrella):** kipu-implement, kipu-commit, kipu-code-review, kipu-spec-review, kipu-mr. kipu-afk is the *reference flow* only.

**Locked at chart time (from grilling):**

- Plan-only destination; hand to a build effort afterward.
- Package/command name is `relay` (renamed from `sandcastle` to avoid colliding with the upstream `@ai-hero/sandcastle` library it is built on); NPM scope `@quantum-hub`.
- Pilot on qc-catalog (Java/Maven); generalization to other repo types is out of scope.
- Hard constraint: orchestration lives in the harness; each role is a first-class `sandcastle.run()` so spawning skills work — inverting kipu-afk's inline-rubric compromise.
- Hard constraint: rebuild from scratch on the author's templates/examples; the qc-catalog spike is reference/prototype only, never a base.
- Recommended build approach (a decision, not a step here): bootstrap via the `sandcastle` CLI, then build up from the author's example workflows.

**Every session:** consult the prior art above; use `/grilling` + `/domain-modeling` for grilling tickets; use a `/research` subagent for research tickets.

## Decisions so far

<!-- one line per closed ticket; empty until tickets resolve -->

- [Sandcastle CLI + framework capabilities](issues/02-sandcastle-cli-capabilities.md) — `sandcastle` CLI only bootstraps (`init` + `docker build-image`); no `run` — our tool is our own TS orchestration on the library API (`run`/`createSandbox`/`claudeCode`/`Output.object`/`branchStrategy: branch`); Jira is not built-in (ours to wire); pin the pre-1.0 version, add zod, UID-matched image.
- [Headless skill delivery](issues/01-headless-skill-delivery.md) — skills reach a headless in-sandbox subagent **only via bind-mount into `~/.claude/skills/<name>`** and must be invoked by capability, never a `/`-slash command; mount kipu-code-review / kipu-spec-review / kipu-commit(+caveman-commit), inline kipu-implement's method. Auto-discovery under `-p` is unproven → spike ticket 11.
- [Work-item selection, type guard, and planner](issues/03-work-item-selection-and-planner.md) — planner is **config-driven** off the repo's `docs/agents/issue-tracker.md` (tracker access, repo label, relation model, issue-type mapping — repo scope sourced from the file, not the git remote); it **verifies-and-orders pre-existing tickets, never authors slices** (on-the-fly decomposition rejected). Auto-pick = frontier JQL narrowed to `issuetype in (Story, Bug, Vulnerability)` (type guard inverts the spike's child-count guard), first by priority DESC / created ASC; explicit key = same gates, no override, any failure breaks the pass. Plan = ephemeral `Output.object` list of ticket refs (has-related-tickets → those in dependency order; none → singleton), handed to the per-ticket loop; loop shape is ticket 07. Under-specified ticket ⇒ bail-to-human, never fabricate.

## Not yet specified

- Resume / needs-input / crash-recovery semantics for a single pass (depends on the orchestration topology).
- The handover artifact's shape — run log, summary, what the human reads to pick up.

## Out of scope

- Generalizing beyond the Java/Maven pilot to the other ~15 repos / Python / TypeScript repo types — a later effort once the pilot works.
- The outer scheduling / poll loop that runs the tool repeatedly — the tool does one pass; the loop is established later.
- Driving a remote GitLab-MR CI pipeline from red to green (the spike's `ci-fix` loop) — the pass ends at the local quality gate + human handover.
