# Sandcastle CLI + framework capabilities

Type: research
Status: resolved
Blocked by: —
Findings: research/02-sandcastle-cli-capabilities.md

## Question

What does the `@ai-hero/sandcastle` framework and its `sandcastle` CLI give us that the packaging and orchestration decisions depend on?

Context: the user's steer is "bootstrap an initial version via the `sandcastle` npx command, then go from there." The package ships a `sandcastle` bin, a `src/templates` dir, and `docker build-image`.

Resolve:

- What does the `sandcastle` CLI do — init / bootstrap / scaffold templates, `docker build-image` (UID/GID alignment), anything else? What does a bootstrapped project look like?
- The programmatic API surface we rely on: `run`, `createSandbox`, `claudeCode`, `Output.object`, `branchStrategy` (`branch` / `head` / `merge-to-head`), hooks, mounts, env, signals/timeouts.
- Version / stability (currently 0.12.0) — anything that constrains a published tool depending on it.

Deliverable: a findings markdown file in this repo, linked from this ticket.

## Answer

Full findings: [research/02-sandcastle-cli-capabilities.md](../research/02-sandcastle-cli-capabilities.md).

- `@ai-hero/sandcastle` v0.12.0 (MIT, pre-1.0, ESM-only). `bin: sandcastle` **only bootstraps** — subcommands are `init`, `docker build-image/remove-image`, `podman build-image/remove-image`. **No `run` subcommand**: agents run by executing a scaffolded `.sandcastle/main.ts` via `npx tsx` against the programmatic API. So our npx tool is our own orchestration script built on the library.
- `sandcastle init` scaffolds `.sandcastle/` (Dockerfile, prompt.md, main.ts, .env) from one of 5 templates. `docker build-image` bakes host UID/GID (`--build-arg AGENT_UID/GID`); docker provider does a pre-flight UID-match check. **Jira is not a built-in tracker** (only github-issues / beads / custom) — the Jira wiring is ours.
- API we rely on: `run()` (one-shot), `createSandbox()` (warm multi-run + `sandbox.exec()` gate), `claudeCode()`, `docker()`/`noSandbox()`, `Output.object/string` (needs our own zod dep + `maxIterations===1`), `signal` / `idleTimeoutSeconds` / `completionSignal` for bounding, and `branchStrategy` — `{ type: "branch", branch }` is the right per-Jira-item choice (only strategy safe for concurrency; `head`/`merge-to-head` are the bind-mount/isolated defaults).
- Author examples model multi-phase orchestration as plain TS: plan → parallel-execute → merge (`createSandbox` per branch, `result.commits.length` gating), plus reusable `runWithExtraction` / `runWithRetry` wrappers that resume a session by `StructuredOutputError.sessionId` for reliable structured output. `implement-pr.ts` shows host-side context gathering injected via `promptArgs`.
- Stability: pre-1.0 with churn (0.11.0 session resume/fork; 0.12.0 `sandbox.exec()`). Pin the version exactly, add zod ourselves, require a UID-matched docker image (or `noSandbox()`), and working Claude Code auth on the host.
