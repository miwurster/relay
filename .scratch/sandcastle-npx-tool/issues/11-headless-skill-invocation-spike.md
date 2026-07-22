# Spike: prove headless skill invocation fires under `-p`

Type: task
Status: open
Blocked by: —

## Question

Does a personal skill bind-mounted into `~/.claude/skills/<name>` actually get **discovered and invoked** by claude-code running headless (`claude --print -p -`) inside a Sandcastle Docker sandbox?

Context: ticket 01 concluded delivery is bind-mount-only and recommends the prototype's mount pattern, but flagged that **headless personal-skill auto-discovery is undocumented** — the prototype implies `kipu-commit` worked, yet no transcript proves the Skill tool fires under `-p`. The whole subagent-topology (ticket 07) rests on this.

Do:

- Minimal spike: one Sandcastle `run()` in a docker sandbox, one skill mounted read-only into `~/.claude/skills/`, a prompt that should trigger it by capability.
- Capture the stream-json and grep for a `Skill` tool_use event (or the skill's effect) to confirm it fired — not just that output looked right.
- If it does not fire: test the fallback levers (`CLAUDE_CONFIG_DIR` env, `--plugin-dir` via provider patch) and record which works.

Resolves to: a proven mechanism (with the evidence) that ticket 07 can design against, or a documented fallback.
