# 01 — Headless skill delivery into a Sandcastle Docker subagent

Research question for the "relay npx tool" wayfinder.
Date: 2026-07-21.

> Status note: the core mechanism findings below come from **primary source** — the
> Sandcastle framework source and the kipu skill files, read directly. The
> claude-code *headless* skill/plugin/MCP loading semantics are corroborated by the
> claude-code-guide docs agent; where a claim rests on that agent rather than a file I
> read myself it is marked **[docs]**, and anything not yet confirmed is called out in
> §5 as an open unknown.

## 1. The concrete question

We are building a tool that runs each AI coding agent as a Sandcastle subagent:
`run({ agent: claudeCode(model), sandbox: docker({...}) })`. Each subagent is
`claude` running **headless** (`--print` / `-p`, prompt on stdin) inside a Docker
container. We want each subagent to be able to invoke our four kipu skills —
`kipu-implement`, `kipu-code-review`, `kipu-spec-review`, `kipu-commit`.

By what concrete mechanism can a headless in-sandbox `claude -p` invoke those skills,
and which mechanism should the tool use?

## 2. What the prototype did, and why

Files:
- `/Users/michael.wurster/work/sandbox/sandcastle_qc-catalog/.sandcastle/shared/sandbox.ts`
- `/Users/michael.wurster/work/sandbox/sandcastle_qc-catalog/.sandcastle/agent-workflows/implement/prompt.md`

Two moves, deliberately split:

**(a) Mounted only the commit skills, read-only, as personal skills.**
`sandbox.ts` lines 50-53:

```ts
mounts: [
  { hostPath: "~/.claude/plugins/marketplaces/kipu/skills/kipu-commit",   sandboxPath: "~/.claude/skills/kipu-commit",   readonly: true },
  { hostPath: "~/.claude/plugins/marketplaces/caveman/skills/caveman-commit", sandboxPath: "~/.claude/skills/caveman-commit", readonly: true },
]
```

Note it mounts **both** `kipu-commit` **and** its dependency `caveman-commit` —
because `kipu-commit`'s `SKILL.md` says "Base rules — read first: `caveman-commit` …
Read its `SKILL.md` and apply it." A mounted skill that reads a sibling skill needs
that sibling mounted too.

**(b) Inlined the implement + TDD workflow into the prompt** instead of mounting
`kipu-implement`/`tdd`. The comment on line 48-49 and `prompt.md` line 29 state the
reason directly:

> "The implement + tdd work method is now inlined in prompt.md (the `/implement` slash
> command did not expand in headless `-p`)…"
> "Do **not** try to invoke a `/implement` or `/tdd` slash command — they will not
> expand in this headless run. The steps here **are** those skills, inlined; execute
> them yourself."

So the prototype pre-dates these being *skills*: it was fighting **slash-command**
non-expansion, and reacted by inlining the method text and keeping only the
mechanical commit step as a real (mounted) skill. `prompt.md` still tells the agent to
"Invoke the **kipu-commit** skill" (line 68) — i.e. the mounted skill is expected to be
model-invocable headless, and only the *orchestration* skills were inlined.

Important consequence the prototype baked in: the implement prompt also strips out all
the tracker coupling (`prompt.md` §"On CI / pipeline failures", §"When you are
blocked") — the harness feeds the ticket/brief/thread as prompt text and forbids the
agent from touching Jira/GitLab/Sonar. That is because `kipu-implement`/`kipu-commit`
lean on `docs/agents/issue-tracker.md` + a Jira MCP that do not exist inside the sandbox.

## 3. What the framework + claude-code actually support headless

### 3.1 The `claudeCode` provider passes NO skill/plugin/MCP/settings flags

`/Users/michael.wurster/work/sandbox/sandcastle/src/AgentProvider.ts`, `claudeCode`
factory (lines 1181-1216). The entire headless command it builds is:

```
claude --print --verbose[ --permission-mode X | --dangerously-skip-permissions] \
  --output-format stream-json --model <m>[ --effort E][ --resume S][ --fork-session] -p -
```

with the prompt on **stdin**. There is **no** `--mcp-config`, `--strict-mcp-config`,
`--settings`, `--append-system-prompt`, `--system-prompt`, `--plugin`,
`--plugin-dir`, `--allowedTools`, or any skill flag. `ClaudeCodeOptions` (lines
1155-1179) exposes only `effort`, `env`, `captureSessions`, `sessionStorage`,
`permissionMode`. **The provider gives us no CLI hook for skills/plugins/MCP.**

Therefore skill/plugin/MCP delivery to the sandboxed agent is **entirely
filesystem-based**: whatever is present under the container's `~/.claude` (and repo
`.claude`/`.mcp.json`) at launch is all the agent has.

### 3.2 The sandbox is a bind-mount container; `~/.claude` is the agent's home and is writable

`/Users/michael.wurster/work/sandbox/sandcastle/src/sandboxes/docker.ts`:
- `sandboxHomedir = "/home/agent"` (line 136); container runs with `HOME=/home/agent`
  (line 187).
- User mounts (`docker({ mounts: [...] })`) are resolved via `resolveUserMounts(...,
  sandboxHomedir)` (line 138) and appended to the internal worktree/git mounts
  (line 162). `MountConfig` (`src/MountConfig.ts`) tilde-expands `sandboxPath` `~/…`
  against `/home/agent`, so `sandboxPath: "~/.claude/skills/kipu-commit"` →
  `/home/agent/.claude/skills/kipu-commit`. **This is the delivery channel.**
- Read-only is supported per-mount (`readonly?: boolean`).

`~/.claude` is NOT wholesale-mounted from the host. Session capture only touches
`/home/agent/.claude/projects` and does so by `docker cp` in/out
(`makeClaudeSessionStorage`, `AgentProvider.ts` lines 352-437;
`copyFileIn`/`copyFileOut` in `docker.ts`), not a bind mount. So mounting individual
subdirs under `~/.claude/skills/<name>` is safe and does not collide with anything the
framework manages.

### 3.3 The image ships plain claude-code, no plugins/skills baked in

`/Users/michael.wurster/work/sandbox/sandcastle/.sandcastle/Dockerfile`:
`FROM node:22-bookworm`; installs git/curl/jq/gh; installs claude via
`curl -fsSL https://claude.ai/install.sh | bash` (line 29). No marketplace add, no
plugin install, no `~/.claude/skills` seeded. A vanilla headless claude with no kipu
anything — unless we mount it or bake it.

### 3.4 "Prompt expansion" in Sandcastle is unrelated to slash commands

To avoid a red herring: Sandcastle's "prompt expansion" (`PromptPreprocessor`, ADR
0020) is host-side shell-command substitution (`` !`cmd` ``) inside prompt template
files, evaluated in the sandbox before the prompt is handed to claude. It has nothing
to do with claude slash-command expansion. So there is no Sandcastle-layer feature that
would expand `/implement` either.

### 3.5 Headless claude-code loading semantics **[docs]**

From the claude-code-guide docs agent (docs.claude.com, URLs below). Important: the
docs are **explicit about the config model but silent about `-p`-mode specifics** for
skills/plugins — so several of these are documented-general + inferred-for-headless, not
documented-for-headless. Flagged accordingly.

- **Skills** live at `~/.claude/skills/<name>/SKILL.md`, are auto-discovered, and are
  either model-invoked (Skill tool) or `/skill-name`-invoked per frontmatter
  (`disable-model-invocation`). Docs: https://code.claude.com/docs/en/skills.md
  **Headless is NOT documented** — there is no confirmation that `~/.claude/skills/`
  auto-discovers under `-p`, and no `--skill`/`--enable-skill` flag exists. The
  prototype's mounted `kipu-commit` is the only real-world evidence it works, and even
  that is inferred. **This is the load-bearing open unknown — see §5.1.** Sandcastle's
  AFK default `--dangerously-skip-permissions` allows all tools, so if the Skill tool
  loads at all it should be permitted.
- **Slash commands are a REPL/interactive affordance** and almost certainly do **not**
  expand in `-p` (docs describe them as interactive-only; no CLI path passes a slash
  command to print mode) — matching the prototype's observation. Skills are the
  headless-friendly replacement: the model calls by capability, not by `/`-command.
  Docs: https://code.claude.com/docs/en/commands.md
- **Plugins/marketplaces headless.** Plugins are installed via marketplace and tracked
  in `enabledPlugins` in `settings.json`; plugin skills are namespaced
  `plugin-name:skill-name`. Docs: https://code.claude.com/docs/en/plugins.md,
  https://code.claude.com/docs/en/discover-plugins.md. Two headless facts matter:
  - `enabledPlugins` from `settings.json` is **suspected NOT to auto-load in `-p`**
    (no documented mechanism) — reinforces avoiding the plugin route.
  - **There IS a documented flag: `--plugin-dir <path>`** (load a plugin from a
    directory, documented for local dev/testing). Its headless scope isn't spelled out,
    but it is the closest thing to a "load these skills for one run" flag. The
    `claudeCode` provider does **not** pass it today — using it would require patching
    the provider (see §4 and §5.5).
  - Personal skills under `~/.claude/skills/` sidestep plugin install entirely — a
    mounted skill dir does not need the plugin "installed."
- **MCP headless** loads from user/project scopes (`~/.claude.json`, project `.mcp.json`)
  and/or an explicit **`--mcp-config <file|json>`** flag. Docs:
  https://code.claude.com/docs/en/mcp-quickstart.md. The `claudeCode` provider passes
  **none** of these, so **MCP servers are effectively unavailable in-sandbox** unless we
  add config files (which the provider still won't point `--mcp-config` at) — patching
  the provider would be required for reliable MCP.
- **`CLAUDE_CONFIG_DIR` env var** overrides the `~/.claude` config root (there is no
  `--settings-dir` flag; the dir override is this env var). **This is usable TODAY**
  because the provider forwards `env` (`claudeCode({ env })` / `docker({ env })`): we
  could point the whole config dir at a mounted, purpose-built tree (skills + settings +
  optionally a marketplace) instead of layering onto `/home/agent/.claude`. Worth a
  spike as an alternative to per-skill mounts.
- Other documented print-mode flags that affect loading: `--system-prompt`,
  `--append-system-prompt` (inject instructions, do **not** expand slash commands),
  `--tools`/`--allowedTools` (tool gating), `--bare` (skip auto-discovery),
  `--max-turns`. Docs: https://code.claude.com/docs/en/cli-reference.md,
  https://code.claude.com/docs/en/settings.md.

### 3.6 The four kipu skills — self-contained vs. dependent

Read from `~/.claude/plugins/marketplaces/kipu/skills/*/SKILL.md`:

| Skill | Spawns subagent? | Skill deps to co-mount | External deps (MCP/tracker) | Inlinable? |
|---|---|---|---|---|
| `kipu-commit` (2.0.1) | No | `caveman-commit` (reads its SKILL.md) | Reads `docs/agents/issue-tracker.md` for scope, but has documented **safe defaults** (omit scope / non-breaking) when absent; "Autonomous operation" = never prompt | Yes, but better mounted (mechanical git) |
| `kipu-code-review` (2.2.0) | No | none | none — pure read-only diff analysis (`git diff <base>..HEAD`) | Yes (single SKILL.md, self-contained) |
| `kipu-spec-review` (1.0.0) | No | none | Reads brief/spec from `.kipu/**` files or tracker; degrades to a passed-in brief | Yes (single SKILL.md, self-contained) |
| `kipu-implement` (2.0.3) | **Yes** — dispatches a fresh general-purpose implementer subagent (`implementer-prompt.md`), model Sonnet→Opus | `tdd` (Matt Pocock; at `.../marketplaces/kipu/.agents/skills/tdd`) + `kipu-commit` (+`caveman-commit`) | Heavy: reads ticket via tracker, claims it, reflects In Progress/In Review — Jira MCP + `docs/agents/issue-tracker.md` | Partially — the *method* inlines well (prototype did it); the tracker orchestration does not survive the sandbox |

Key structural facts:
- `kipu-implement` is an **orchestrator**: it reads a ticket from the tracker, dispatches
  a subagent via the Task tool, handles its status, then calls `kipu-commit`, and
  reflects tracker state. Headless `-p` **can** spawn Task subagents, but the tracker
  I/O (`In Progress`/`In Review`, claim/assign) assumes Jira-over-MCP that the sandbox
  does not have.
- `kipu-implement` and `kipu-commit` both key off `docs/agents/issue-tracker.md`, which
  lives in the *target repo*, not the sandbox base image. For qc-catalog the prototype
  simply removed that dependency by inlining and feeding the ticket as prompt text.
- The two review skills are the cleanest: one file each, read-only, no subagent, no
  MCP. They are drop-in mountable **or** inlinable.

## 4. Recommended mechanism

**Primary mechanism: read-only personal-skill bind mounts into `~/.claude/skills/<name>`,
co-mounting each skill's skill-level dependencies.** This is the only channel the
current `claudeCode` provider supports, it is proven by the prototype for `kipu-commit`,
and it keeps skills model-invocable headless without any plugin-install or MCP
machinery.

Concretely, per subagent:

```ts
docker({
  mounts: [
    // reviews — self-contained, safe to mount as-is
    { hostPath: "~/.claude/plugins/marketplaces/kipu/skills/kipu-code-review", sandboxPath: "~/.claude/skills/kipu-code-review", readonly: true },
    { hostPath: "~/.claude/plugins/marketplaces/kipu/skills/kipu-spec-review", sandboxPath: "~/.claude/skills/kipu-spec-review", readonly: true },
    // commit — mount with its caveman-commit base
    { hostPath: "~/.claude/plugins/marketplaces/kipu/skills/kipu-commit",        sandboxPath: "~/.claude/skills/kipu-commit",        readonly: true },
    { hostPath: "~/.claude/plugins/marketplaces/caveman/skills/caveman-commit",  sandboxPath: "~/.claude/skills/caveman-commit",     readonly: true },
    // implement — mount only if driving it as a skill (see below); needs tdd + commit too
    { hostPath: "~/.claude/plugins/marketplaces/kipu/skills/kipu-implement",     sandboxPath: "~/.claude/skills/kipu-implement",     readonly: true },
    { hostPath: "~/.claude/plugins/marketplaces/kipu/.agents/skills/tdd",        sandboxPath: "~/.claude/skills/tdd",                readonly: true },
  ],
})
```

Then the prompt tells the agent to invoke the skill by capability (e.g. "review the
branch with the kipu-code-review skill", "commit with the kipu-commit skill") — **not**
via a `/`-slash command.

Per-skill recommendation:

1. **`kipu-code-review`, `kipu-spec-review` → MOUNT as-is.** Self-contained, read-only,
   no subagent, no MCP. Lowest risk. (Spec-review: feed the brief/spec as a prompt file
   or a `.kipu/**` path since there's no tracker.)
2. **`kipu-commit` → MOUNT with `caveman-commit`.** Proven by the prototype. Its
   autonomous/safe-default design already tolerates a missing tracker (scope falls back
   to the branch-name key or is omitted). Ensure the prompt states it's an authorised
   headless run so it commits directly.
3. **`kipu-implement` → prefer INLINE the method (prototype pattern), OR mount it +
   `tdd` + `kipu-commit` and neuter the tracker steps in the prompt.** Reasons:
   - Skill *delivery* is not the blocker; the tracker orchestration is. `kipu-implement`
     wants to read/claim/reflect a Jira ticket over MCP that the sandbox lacks.
   - The tool already owns ticket selection, branch prep, and lifecycle
     (`sandcastle.run`), so the skill's orchestration duplicates the harness. Inlining
     the *engineering method* (map → TDD red/green → focused tests → self-review) and
     letting the harness own ticket/commit/push is the cleaner seam — exactly what the
     qc-catalog prototype settled on.
   - If we do want the real skill, mount `kipu-implement` + `tdd` + `kipu-commit` +
     `caveman-commit`, set `KIPU_UNATTENDED=1` (via `docker({ env })` or
     `claudeCode({ env })`), hand the ticket brief as a mounted/written file, and tell it
     the tracker is unavailable so it skips reflections (its own docs say: "Where the doc
     describes no such state, skip the reflection").

### Mechanism tradeoffs

| Mechanism | Pros | Cons |
|---|---|---|
| **Read-only mount into `~/.claude/skills`** (recommended) | Only channel the provider supports; always fresh from host; no image rebuild; no plugin/MCP config; proven | Must co-mount skill deps by hand; host must have the plugin cache present; version = whatever's on the host |
| **Bake skills into the Docker image** (`COPY … /home/agent/.claude/skills/…`) | Reproducible/pinned; no host-path coupling; good for CI | Rebuild + `sandcastle docker build-image` on every skill bump; drifts from host |
| **Full plugin install in image** (marketplace add + `enabledPlugins` in `settings.json`) | Skills load exactly as on host, grouped by plugin | Heaviest; pulls in kipu-all's MCP servers (atlassian, sonarqube) that need creds/network and the provider never passes `--mcp-config`; overkill for 4 skills |
| **Inline the skill body into the prompt** | No mount; no dependency graph; survives no-tracker sandbox; guaranteed to "expand" | Skill text drifts from source; bloats prompt/context; loses the model-invoked Skill-tool ergonomics; only sane for orchestration skills (implement), not the mechanical ones |
| **`--plugin-dir <path>` flag** (documented) | Real, documented flag to load a plugin's skills for one run; namespaced `plugin:skill` | Provider does **not** pass it — needs a `claudeCode()`/provider patch; headless scope undocumented; loads a *plugin*, so pulls the plugin's structure |
| **`CLAUDE_CONFIG_DIR` env var** (usable today) | Provider forwards `env`, so no code patch — point the whole config root at a mounted tree (skills + settings + marketplace) | Replaces `~/.claude` wholesale (must reproduce anything else the agent needs there); headless behaviour of the pointed-at dir still rests on §5.1 |

**Net:** mount reviews + commit (proven, cheap); inline (or mount-with-neutering)
implement because its blocker is the tracker, not delivery. `CLAUDE_CONFIG_DIR` is the
no-patch alternative worth a spike; `--plugin-dir`/`--mcp-config` need a provider patch.
Consider baking into the image later if we want pinned versions in CI.

## 5. Open unknowns needing a real proof/spike

1. **THE load-bearing unknown — headless personal-skill discovery is undocumented.**
   The docs (skills.md) describe `~/.claude/skills/` auto-discovery generally but say
   **nothing** about `-p`/print mode, and there is no `--skill` flag. Confirm on a live
   `claude --print -p -` run inside the sandcastle image that a personal skill mounted at
   `~/.claude/skills/<name>/SKILL.md` is actually listed to the model and invocable via
   the Skill tool under `--dangerously-skip-permissions`. The prototype implies it works
   for `kipu-commit` but I have not seen a transcript proving the Skill tool fired
   headless. **Spike:** minimal image + one mounted skill + `claude --print
   --output-format stream-json -p -` with a triggering prompt; grep the stream-json for a
   `Skill` tool_use event. If it fails, fall back to `--plugin-dir` (provider patch) or
   `CLAUDE_CONFIG_DIR` (env, no patch) and re-test.
2. **Skill-tool availability without `--dangerously-skip-permissions`.** If the tool ever
   runs with `permissionMode` instead of skip-permissions, verify the Skill tool is
   still allowed (may need an allow-list). Unconfirmed.
3. **Subagent (Task tool) headless + model override.** `kipu-implement` dispatches a
   Task subagent with an explicit `model:`. Confirm Task subagents spawn under `-p` and
   that the child sees the same mounted `~/.claude/skills` (it shares the container home,
   so it should) and honours `model:`. Untested here.
4. **`kipu-commit` scope with no tracker.** Verify its safe-default path actually
   resolves scope from the branch name (`PSD-123`-style) inside the sandbox and does not
   stall waiting on `docs/agents/issue-tracker.md`. The SKILL.md says it should; confirm
   on a real branch.
5. **Whether we should patch the provider** to pass `--mcp-config`/`--settings` so
   MCP-backed skills (or the real tracker) could work in-sandbox — a product decision,
   not just research. Today the provider offers no such hook.
6. **Host-path coupling of mounts.** The recommended mounts read from
   `~/.claude/plugins/marketplaces/kipu/...` and `.../caveman/...` on the operator's
   host. The npx tool must either require those plugins installed on the host or ship/bake
   the skills itself. Decide the distribution story.
