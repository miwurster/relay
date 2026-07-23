# Headless skill delivery into sandbox subagents

Type: research
Status: resolved
Blocked by: —
Findings: research/01-headless-skill-delivery.md

## Question

Can our kipu skills (kipu-implement, kipu-code-review, kipu-spec-review, kipu-commit) drive a **headless** claude-code subagent running inside a Sandcastle Docker sandbox — and if so, by what mechanism?

Context: the qc-catalog spike found that `/implement` and `/tdd` slash-commands **do not expand in headless `-p` runs**, so it inlined the skill content into the prompt and only mounted `kipu-commit` read-only into `~/.claude/skills`. The new tool wants each role to be a proper skill-driven subagent.

Resolve:

- What actually makes a skill available and invocable in a headless `sandcastle.run(claudeCode(...))` process? (marketplace plugin install in the image, read-only mount of skill dirs, some flag / settings.json, or must-inline?)
- Do plugins/MCP configured on the host propagate into the sandbox, or must the image carry them?
- Is there a supported way to trigger a skill non-interactively, or is inlining the skill body the only reliable path?

Deliverable: a findings markdown file in this repo, linked from this ticket, with a recommended mechanism (or a small proof).

## Answer

Full findings: [research/01-headless-skill-delivery.md](../research/01-headless-skill-delivery.md).

- Delivery is **filesystem-only**: the Sandcastle `claudeCode` provider runs `claude --print -p -` and passes **no** skill/plugin/MCP/settings flags. Skills reach the sandbox solely via **bind-mounts** into the container's `~/.claude/skills/<name>` (`HOME=/home/agent`).
- Recommended mechanism: mount `kipu-code-review` + `kipu-spec-review` (self-contained, read-only) and `kipu-commit` + its `caveman-commit` dependency read-only as personal skills — the proven prototype pattern — **invoked by capability in the prompt, never as a `/`-slash command** (slash commands do not expand headless).
- For `kipu-implement`: prefer **inlining** the method (as the prototype did), or mount it plus `tdd` + `kipu-commit`. Its real blocker isn't delivery but its Jira/tracker-over-MCP orchestration, which the sandbox lacks — so the harness feeds context, the subagent runs the inlined method.
- Avoid the full plugin-install route (heavy, pulls kipu-all MCP servers; `enabledPlugins` likely won't auto-load headless). Two fallback levers if mounts fall short: `--plugin-dir` (needs a provider patch) and `CLAUDE_CONFIG_DIR` env (usable today, provider forwards env).
- **Load-bearing open unknown:** headless personal-skill auto-discovery is undocumented — the prototype implies `kipu-commit` worked but no transcript proves the Skill tool fires under `-p`. → spun out as ticket 11 (a one-mount spike). Design topology (07) on the recommended mechanism, confirm with 11.
