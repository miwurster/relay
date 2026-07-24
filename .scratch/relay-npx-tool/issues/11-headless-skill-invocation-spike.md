# Spike: prove headless skill invocation fires under `-p`

Type: task
Status: resolved
Blocked by: —

## Question

Does a personal skill bind-mounted into `~/.claude/skills/<name>` actually get **discovered and invoked** by claude-code running headless (`claude --print -p -`) inside a Sandcastle Docker sandbox?

Context: ticket 01 concluded delivery is bind-mount-only and recommends the prototype's mount pattern, but flagged that **headless personal-skill auto-discovery is undocumented** — the prototype implies `kipu-commit` worked, yet no transcript proves the Skill tool fires under `-p`. The whole subagent-topology (ticket 07) rests on this.

Do:

- Minimal spike: one Sandcastle `run()` in a docker sandbox, one skill mounted read-only into `~/.claude/skills/`, a prompt that should trigger it by capability.
- Capture the stream-json and grep for a `Skill` tool_use event (or the skill's effect) to confirm it fired — not just that output looked right.
- If it does not fire: test the fallback levers (`CLAUDE_CONFIG_DIR` env, `--plugin-dir` via provider patch) and record which works.

Resolves to: a proven mechanism (with the evidence) that ticket 07 can design against, or a documented fallback.

## Answer

**PROVEN — fires by capability.** A personal skill placed in `~/.claude/skills/<name>` is auto-discovered and invoked as the `Skill` tool by headless `claude --print`, both at the bare CLI and inside the exact CI-parity Docker image (`sandcastle:qc-catalog`, native binary, `agent` user) with the skill **bind-mounted read-only** to the default location. Confirmed two independent ways per run — the `Skill` tool_use event in the stream-json **and** the skill's distinctive effect:

- Step A (bare CLI, isolated `CLAUDE_CONFIG_DIR`): `"name":"Skill","input":{"skill":"cave-echo","args":"hello-world-42"}` + marker emitted.
- Step B (docker, `-v …/cave-echo:/home/agent/.claude/skills/cave-echo:ro`): `"name":"Skill","input":{"skill":"cave-echo","args":"docker-fidelity-99"}` + marker emitted.

**Follow-up — slash also works, revising the prototype's finding.** A second battery (Steps C–H) tested the `/name` slash form directly. `claude -p "/name args"` **does** expand headless — client-side prompt injection, before the model, **zero tool_use** — proven decisively with a `disable-model-invocation: true` command (Step G fires by slash; Step H, the by-name control, does not). So the prototype's "`/implement` did not expand" note is **stale** (earlier claude) or `/implement` wasn't actually installed then. Three delivery paths all work headless: **slash expansion** (`/name`, no tool event), **capability** (plain prompt → `Skill` tool), **by-name** (→ `Skill` tool, suppressible). Ticket 01's "never slash" rule is **relaxed**.

**Caveat:** every artifact tested is a **personal** skill/command under the config dir. The real relay skills are **plugin marketplace** skills — plugin exposure under `-p` was not tested and could differ. The build must re-verify with an actual kipu plugin skill.

**No fallback lever needed** (`CLAUDE_CONFIG_DIR` / `--plugin-dir` untested — primary paths work). Ticket 07 may pick per role between slash-expanding a mounted command and capability-invoking a mounted skill, subject to the plugin caveat.

Evidence + raw stream-json: `.scratch/relay-npx-tool/research/spike-11/` ([FINDINGS.md](../research/spike-11/FINDINGS.md), `stream-A..H.jsonl`).
