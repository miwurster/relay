# Sandcastle CLI and framework capabilities

Research for the `@quantum-hub/sandcastle` npx tool.
Sources: `/Users/michael.wurster/work/sandbox/sandcastle` (framework, v0.12.0) and the real usage in `/Users/michael.wurster/work/sandbox/course-video-manager/.sandcastle/`.

## 1. The question

What does the `@ai-hero/sandcastle` framework and its `sandcastle` CLI give us that our packaging and orchestration decisions depend on?
We are building a distributable npx tool that runs one AFK agent pass over a Jira work item, orchestrated as Sandcastle subagents.
The steer: "bootstrap an initial version via the `sandcastle` npx command, then go from there."

## 2. What the `sandcastle` CLI does

The package is `@ai-hero/sandcastle` (`/Users/michael.wurster/work/sandbox/sandcastle/package.json`).
Key facts from `package.json`:

- `"bin": { "sandcastle": "dist/main.js" }` — the CLI entrypoint.
- ESM only (`"type": "module"`), `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`.
- Subpath exports for each sandbox provider: `@ai-hero/sandcastle/sandboxes/docker`, `.../podman`, `.../vercel`, `.../daytona`, `.../no-sandbox`.
- `"files": ["dist"]` — only `dist` is published. `postbuild` copies `src/templates` into `dist/templates`, so the scaffolding templates ship inside the package.
- Runtime dep is only `@clack/prompts` (interactive prompts). `@vercel/sandbox` and `@daytona/sdk` are optional peer deps. Everything else (`effect`, `zod`, `tsup`, etc.) is a devDependency — the CLI is built with the Effect CLI framework (`@effect/cli`).

The CLI entrypoint is `src/main.ts` -> compiles to `dist/main.js`. It wires an Effect `cli(process.argv)` (`src/cli.ts`) with a `ClackDisplay` layer and friendly error handling. The command tree (`src/cli.ts` lines ~684-696) is:

```
sandcastle
├── init
├── docker
│   ├── build-image
│   └── remove-image
└── podman
    ├── build-image
    └── remove-image
```

There is **no `run` subcommand**. The CLI only scaffolds and manages images. Actually *running* agents is done by executing the scaffolded `.sandcastle/main.ts` yourself with `npx tsx`, which calls the programmatic API (see section 3). This is the key architectural point: the CLI bootstraps, the JS/TS API orchestrates.

### `sandcastle init`

Scaffolds the `.sandcastle/` directory and (optionally) builds the container image. Interactive by default, but every prompt has a paired `--flag` so it can run non-interactively (fails fast if stdin is not a TTY and a required flag is missing). Errors if `.sandcastle/` already exists.

Flags (README lines 774-784): `--image-name` (default `sandcastle:<repo-dir-name>`), `--agent` (`claude-code`, `pi`, `codex`, `cursor`, `opencode`, `copilot`), `--model`, `--sandbox` (`docker`, `podman`), `--template`, `--issue-tracker` (`github-issues`, `beads`, `custom`), `--create-label`, `--build-image`, `--install-template-deps`.

Init detects the host package manager (npm/pnpm/yarn/bun) and, for templates that import a host dep (the planner templates import `zod` for their `<plan>` schema), offers to install it.

A bootstrapped project looks like:

```
.sandcastle/
├── Dockerfile      # or Containerfile for podman
├── prompt.md       # agent instructions (the SKELETON_PROMPT, src/templates.ts)
├── main.ts / main.mts   # orchestration entrypoint (template-specific)
├── .env.example    # token placeholders (CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY)
└── .gitignore      # ignores .env, logs/
```

The `main` file is named `main.ts` when the host `package.json` has `"type": "module"`, else `main.mts`. Five templates (`src/templates/*/`, each with a `template.json` + `main.mts` + prompt files):

| Template | What its `main.mts` does |
| --- | --- |
| `blank` | Single `run({ agent, sandbox: docker(), promptFile })` call. Nothing else. |
| `simple-loop` | One `run()` with `maxIterations: 3`, `branchStrategy: merge-to-head`, `copyToWorktree: ["node_modules"]`, `onSandboxReady: npm install`. |
| `sequential-reviewer` | Implement then review each issue in sequence. |
| `parallel-planner` | Phase 1 plan -> Phase 2 execute on parallel branches -> Phase 3 merge. |
| `parallel-planner-with-review` | Same, plus a per-branch review step. |

The `custom` issue-tracker choice scaffolds a deliberately-broken-until-configured project plus a `.sandcastle/SETUP_ISSUE_TRACKER.md` prompt you feed to a coding agent to wire up your own tracker (relevant for us: **Jira is not built in**; we would use `custom` or, more likely, hand-write the orchestration and prompts referencing our Atlassian MCP).

### `sandcastle docker build-image` / `remove-image` (and podman equivalents)

`build-image` rebuilds the image from an existing `.sandcastle/Dockerfile`. Critical UID/GID detail (`src/cli.ts` `buildImageCommand`, line 567): it passes `buildArgs: defaultUidBuildArgs()`, i.e. on Linux/macOS `--build-arg AGENT_UID=$(id -u)` / `AGENT_GID=$(id -g)`, so the image's `agent` user matches the host UID. This avoids permission errors on bind-mounted files without a runtime chown.

The docker provider enforces this at runtime (`src/sandboxes/docker.ts`):
- `containerUid` defaults to `process.getuid?.() ?? 1000`, `containerGid` to `process.getgid?.() ?? 1000`; used as `--user ${uid}:${gid}`.
- `checkImageUid()` (lines 398-439) is a pre-flight: it inspects `{{.Config.User}}` and, on a numeric UID mismatch, throws telling you to rebuild with `sandcastle docker build-image` or pass `containerUid` to `docker()`.
- If the image is missing entirely, error: "Image '<name>' not found locally. Build it first with 'sandcastle docker build-image'."

The scaffolded Dockerfile (`course-video-manager/.sandcastle/Dockerfile`) is `FROM node:22-bookworm`, installs git/curl/jq/gh, renames the base `node` user (UID 1000) to `agent`, installs Claude Code CLI, and `ENTRYPOINT ["sleep", "infinity"]`. Sandcastle bind-mounts the git worktree at `/home/agent/workspace` and sets that as the workdir.

## 3. Programmatic API surface we will rely on

Public exports (`src/index.ts`). All the important ones:

- **`run(options: RunOptions): Promise<RunResult>`** — the one-shot orchestrator. Creates a sandbox, runs the agent (up to `maxIterations`), collects commits, tears down. This is what a single AFK pass over one Jira item maps to most directly.
- **`createSandbox(options): Promise<Sandbox>`** — a reusable warm sandbox. Call `sandbox.run(...)` multiple times on the same branch/container (implement -> review -> edit) without paying container boot each time. Has `sandbox.exec(cmd, opts?)` for shell commands (tests/lint gates; non-zero exitCode returned, not thrown), `sandbox.interactive(...)`, `sandbox.close()`, and `[Symbol.asyncDispose]` (use with `await using`).
- **`createWorktree(options): Promise<Worktree>`** — git worktree as a first-class concept, independent of any sandbox. Only `branch` and `merge-to-head` strategies (a `head` worktree is a compile-time error). Useful for interactive-then-AFK handoff. Split ownership: `wt.createSandbox()` then `sandbox.close()` tears down the container only; `wt.close()` cleans the worktree.
- **`interactive(options)`** — TUI session (not needed for an unattended npx tool).
- **`claudeCode(model, opts?)`**, plus `codex`, `pi`, `cursor`, `opencode`, `copilot` — agent providers. `claudeCode("claude-opus-4-8", { effort, env, captureSessions, permissionMode })`. `effort` is `low|medium|high|xhigh|max`. `permissionMode` maps to Claude's `--permission-mode`; when set it replaces the default `--dangerously-skip-permissions` on AFK runs.
- **`docker(opts?)`** (from `@ai-hero/sandcastle/sandboxes/docker`), plus `podman`, `vercel`, `daytona`, `noSandbox`. Docker options include `imageName`, `containerUid/Gid`, `mounts`, `env`, `network`, `groups` (`--group-add`, e.g. for a mounted docker socket), `devices`, `cpus`, `selinuxLabel`.
- **`Output.object({ tag, schema, maxRetries? })`** and **`Output.string({ tag, maxRetries? })`** (`src/Output.ts`) — extract a typed payload from a `<tag>` in the agent's stdout. `schema` is any Standard Schema validator (Zod works). Requires `maxIterations === 1` and the tag must literally appear in the resolved prompt. Failure throws `StructuredOutputError` carrying `commits`, `branch`, `preservedWorktreePath`, `sessionId`, `sessionFilePath` — enough to resume the same session and retry. `maxRetries > 0` (added in 0.11.0) has Sandcastle auto-resume+retry; requires a resumable provider (claudeCode/codex/pi).
- **`createBindMountSandboxProvider` / `createIsolatedSandboxProvider`** — build your own provider.

### `RunOptions` (the fields our tool cares about)

Required: `agent` (AgentProvider), `sandbox` (SandboxProvider). Prompt: exactly one of `prompt` (inline, literal — no substitution) or `promptFile` (supports `{{KEY}}` substitution from `promptArgs`, `` !`command` `` shell expansion run *inside the sandbox*, and built-in `{{SOURCE_BRANCH}}`/`{{TARGET_BRANCH}}`). Others:

- `cwd` — host repo dir; anchor for `.sandcastle/` artifacts and git ops. `promptFile` resolves against `process.cwd()`, NOT `cwd` (footgun).
- `branchStrategy` — see below.
- `promptArgs` — `{{KEY}}` -> value map (only with `promptFile`).
- `maxIterations` — default `1`. (For our single AFK pass: leave at 1, or a small number with a completion signal.)
- `name` — log prefix.
- `hooks` — `{ host: { onWorktreeReady, onSandboxReady }, sandbox: { onSandboxReady } }`. Each is an array of `{ command }`. Sandbox `onSandboxReady` runs `npm install` etc. before the agent starts.
- `copyToWorktree: string[]` — host files copied in before container start. **Not supported with `branchStrategy: head`.**
- `logging` — `{ type: "file", path, onAgentStreamEvent?, verbose? }` or `{ type: "stdout", verbose? }`. `onAgentStreamEvent` forwards each text/toolCall/raw event to your own observability (errors swallowed).
- `completionSignal` — string or string[]; default `<promise>COMPLETE</promise>`. First match stops the loop early; returned as `result.completionSignal`.
- `idleTimeoutSeconds` — default `600`. Fails with `AgentIdleTimeoutError` if the agent produces no output for this long *before* any completion signal.
- `completionTimeoutSeconds` — default `60`. Grace window *after* the completion signal is seen but the process hasn't exited (hanging `gh`/MCP child). Resolves successfully with a warning; commits preserved. (ADR 0019.)
- `resumeSession: string` — resume a prior claudeCode/codex/pi session. Incompatible with `maxIterations > 1`.
- `signal: AbortSignal` — cancels the run; kills the in-flight agent subprocess and lifecycle hooks; worktree preserved; rejects with `signal.reason`. This is our timeout/cancellation lever for a bounded npx run.
- `timeouts` — override built-in lifecycle step timeouts: `copyToWorktreeMs` (60000), `gitSetupMs` (10000), `commitCollectionMs` (30000), `mergeToHostMs` (30000).
- `output` — `Output.object/string` (requires `maxIterations === 1`).

### `RunResult`

`iterations: IterationResult[]` (`.length` = count; each has `sessionId?`, `sessionFilePath?`, `usage?` token counts), `completionSignal?`, `stdout`, `commits: {sha}[]`, `branch`, `logFilePath?`, `output?` (present only when `output` set). On resumable providers the result also carries `resume(prompt, opts?)` and `fork(prompt, opts?)`.

### branchStrategy options explained

Type union in `src/SandboxProvider.ts` (lines 246-289). Three strategies:

- **`{ type: "head" }`** — agent writes directly to the host working directory. No worktree, no branch indirection. Default for bind-mount providers (docker/podman). Cannot use `copyToWorktree`. Not safe for concurrent fan-out.
- **`{ type: "merge-to-head" }`** — Sandcastle makes a temp branch in a git worktree; agent works there; commits are merged back to the host's current HEAD when done; temp branch deleted after merge. Default for isolated providers (vercel/daytona).
- **`{ type: "branch", branch: "agent/fix-42" }`** — commits land on an explicitly named branch in a worktree. Re-running the same branch reuses the worktree and fast-forwards from origin when safe (ADR 0003). **This is the strategy for our use case** — we want a named branch per Jira item that we can then open an MR from, and it is the only one safe for concurrent runs.

Provider defaults: bind-mount -> `head`; isolated -> `merge-to-head`.

## 4. How the author's examples structure a multi-phase orchestration

Two patterns to model ours on.

### (a) Plan -> parallel execute -> merge (`course-video-manager/.sandcastle/main.ts`, mirrors `parallel-planner-with-review` template)

Single `main.ts` run with `npx tsx`, wrapping the whole thing in a `for` loop of iterations:

1. **Plan** — `sandcastle.run({ sandbox: docker(), name: "Planner", agent, promptFile: plan-prompt.md })`. The prompt tells the agent to emit a `<plan>...</plan>` JSON block; the harness regex-extracts and `JSON.parse`s it into `{ issues: {number, title, branch}[] }`. (This predates `Output.object`; newer code would use structured output.)
2. **Execute + review** — `Promise.allSettled` over issues with a hand-rolled `MAX_PARALLEL=4` semaphore. For each issue: `await using sandbox = await createSandbox({ sandbox: docker(), branch: issue.branch, copyToWorktree: ["node_modules"], hooks: { sandbox: { onSandboxReady: [{ command: "npm install && npm run build" }] } } })`, then `sandbox.run({ name: "Implementer #N", promptFile: implement-prompt.md, promptArgs })`, and if `result.commits.length > 0`, a second `sandbox.run({ name: "Reviewer #N", promptFile: review-prompt.md })` **on the same warm sandbox/branch**.
3. **Merge** — one `sandcastle.run({ name: "Merger", maxIterations: 10, promptFile: merge-prompt.md, promptArgs: { BRANCHES, ISSUES } })` that merges all branches with commits.

Takeaways for us: each "subagent" is a distinct `run()`/`sandbox.run()` call with its own prompt file and `promptArgs`; phases are plain TS control flow (loops, `Promise.allSettled`, semaphore); `result.commits.length` gates whether downstream phases run; named branches (`branchStrategy` implied by `createSandbox({ branch })`) isolate concurrent work.

### (b) Produce -> extract, with retry (`course-video-manager/.sandcastle/{run-with-retry,run-with-extraction}.ts` + `implement-pr/implement-pr.ts`)

Two reusable wrappers the author wrote on top of `run()`:

- **`runWithExtraction`** (two-phase): run `produce` with NO `output` (so a bad tag can't abort and lose commits), grab `produce.iterations.at(-1).sessionId`, then resume that session with a separate `extractionPrompt` + the `output` definition via `runWithRetry`. Returns the produce run's commits/branch with the extraction run's typed `output`. Used when the produce phase has side effects (commits, issue creation) that must not be repeated.
- **`runWithRetry`** (one-phase): run the prompt WITH `output`; on `StructuredOutputError`, resume `error.sessionId` with a feedback message (`buildRetryFeedback`) so the agent only re-emits corrected JSON, up to `maxAttempts` (default 3). Used for side-effect-free work where the output *is* the work.

`implement-pr.ts` shows the full real shape: gather context on the host with `gh` CLI + `execFileSync` + Zod-validated JSON, pass it in via `promptArgs` (e.g. `PR_COMMENTS_JSON: JSON.stringify(...)`), run `runWithExtraction({ agent: claudeCode(..., { env: { CLAUDE_CODE_OAUTH_TOKEN } }), sandbox: noSandbox(), logging: { type: "stdout" }, promptFile, promptArgs, output: Output.object({ tag: "output", schema }), extractionPrompt })`, then post-process `result.output` and `result.commits` and write artifact files. Note it uses `noSandbox()` (runs on host) — an option if we do not want container isolation.

For our Jira tool this is the closest template: gather the work item on the host (via Atlassian MCP or a fetch), inject it as `promptArgs`, run one produce pass that commits on a named branch, optionally extract a structured summary for the MR body.

## 5. Version / stability constraints

- Current version **0.12.0** (`package.json`), MIT, repo `mattpocock/sandcastle`. Pre-1.0 — expect churn; the CHANGELOG shows frequent minor bumps that add/rename API surface.
- Recent CHANGELOG entries we depend on:
  - **0.12.0**: default Claude model bumped to `claude-opus-4-8`; `sandbox.exec()` added to the `createSandbox()` handle (our verification-gate lever).
  - **0.11.0**: `maxRetries` on `Output.object/string`; `resumeSession` + `.resume()`/`.fork()` on `SandboxRunResult`; session capture fix for bind-mount providers (before this, `iterations[].usage` was `undefined` on docker/podman).
  - **0.10.0**: `verbose` logging option.
- The `runWithRetry` wrapper comment notes `StructuredOutputError.sessionId` requires host Sandcastle **>= 0.5.12** — so session-resume features are relatively recent and version-gated. Pin an exact version (or tight `~`) in our tool.
- ESM-only, Node. Ships `dist` only, but includes `dist/templates`. Runtime dep footprint is tiny (`@clack/prompts`); Zod is only needed by *us* if we use `Output.object` (it is a devDependency in the framework, so **we must add zod as our own dependency**). Vercel/Daytona SDKs are optional peers — irrelevant if we use docker/podman/noSandbox.
- Session capture writes to host `~/.claude/projects/...` (Claude), `~/.codex/...`, `~/.pi/...`. Capture failure fails the run. For a distributed tool this means the invoking user needs a working Claude Code auth (`CLAUDE_CODE_OAUTH_TOKEN` via `claude setup-token`, or `ANTHROPIC_API_KEY`) and, for docker, a locally built image whose UID matches the host.

### Packaging implications for `@quantum-hub/sandcastle`

1. We depend on `@ai-hero/sandcastle` as a library (`run`, `createSandbox`, `claudeCode`, `docker`/`noSandbox`, `Output`) — the CLI itself only bootstraps. Our npx tool is essentially our own `main.ts` orchestration published as a bin.
2. `sandcastle init` is a one-time dev-time bootstrap for the `.sandcastle/` dir + image; it is NOT something our end users run per-invocation. We either ship a pre-authored `.sandcastle/` (Dockerfile, prompts) or bake prompts into our package.
3. Jira is not a built-in issue tracker (only github-issues/beads/custom) — the Jira wiring is ours to write (gather work item -> `promptArgs`), following the `implement-pr.ts` host-side-context pattern.
4. Branch-per-item -> `branchStrategy: { type: "branch", branch }` (or `createSandbox({ branch })`). Bound the run with `signal` (AbortController) and/or `idleTimeoutSeconds`.
5. Pin the `@ai-hero/sandcastle` version exactly (pre-1.0), add `zod` as a direct dep if using structured output, require docker image build with matching UID (or use `noSandbox()` to sidestep containers).
