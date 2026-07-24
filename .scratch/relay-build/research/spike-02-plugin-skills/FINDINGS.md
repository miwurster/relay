# Spike 02 — plugin (marketplace) skills invoke headless under `-p`

**Verdict: PROVEN.** A real kipu-* **plugin** skill (`kipu-commit`, byte-identical to the installed
`kipu-all` copy) is discovered and invoked as the `Skill` tool by headless `claude --print` inside the
CI-parity sandbox, delivered by a session-scoped `--plugin-dir` mount. Both invocation paths fire —
**capability** (plain task matching the skill `description`) and **by-name**. Spike 11's caveat
(plugin exposure untested) is now closed.

Date: 2026-07-24. claude-code 2.1.218. Model: `claude-haiku-4-5-20251001` (discovery is a
client/CLI layer, model-independent — same basis as spike 11).

## Delivery mechanism tested

`claude --plugin-dir <dir>` — a documented CLI flag that loads a plugin from a directory **for the
session only**, no `installed_plugins.json` / `enabledPlugins` / marketplace surgery. The mounted dir
is a minimal real plugin: `.claude-plugin/plugin.json` (name `kipu-all`, no MCP servers, no
`userConfig` — both irrelevant to skill discovery) wrapping the **verbatim** `skills/kipu-commit/SKILL.md`.

This is the "mount plugin skills directly" option. It is contrasted against spike 11's proven
**personal-artifact** fallback (bind-mount the same `SKILL.md` into `~/.claude/skills/kipu-commit`).

## Two-way evidence per run

1. **stream-json** — a `Skill` tool_use event naming the discovered skill.
2. **effect** — a real git commit lands on top of the seed commit in a throwaway repo (kipu-commit is
   fully autonomous: never asks, commits directly). All four commits are Conventional-Commits shaped,
   proving the skill **body** ran, not just that a tool event appeared.

Four cases, all inside `sandcastle:qc-catalog`, native binary, `agent` user:

| Case | Delivery | Prompt shape | `Skill` event `skill` field | Commit landed |
|------|----------|--------------|------------------------------|---------------|
| plugin-capability   | `--plugin-dir` | capability | `kipu-all:kipu-commit` | `feat: add v2 marker` |
| plugin-byname       | `--plugin-dir` | by-name    | `kipu-all:kipu-commit` | `chore: update app.txt` |
| personal-capability | `~/.claude/skills` | capability | `kipu-commit`       | `feat: release v2` |
| personal-byname     | `~/.claude/skills` | by-name    | `kipu-commit`       | `chore: add v2 to app` |

Exactly one `Skill` event per run; `claude` exit 0; empty stderr.

## The one behavioural difference — qualified skill name

Plugin-delivered skills fire under the **plugin-qualified** name `<plugin>:<skill>`
(`kipu-all:kipu-commit`); personal skills fire under the **bare** name (`kipu-commit`). Both auto-fire
by capability and both accept a by-name prompt — the qualification does not change *whether* it fires,
only the string in the `Skill` tool_use `input.skill`. Matches how the plugin skills appear in a
normal session (`kipu-all:code-review`, `caveman:caveman-commit`, …).

## Decision (issue 02)

**Mount plugin skills directly via `--plugin-dir`.** Confirmed to expose real kipu-* plugin skills
headless in-sandbox, by capability and by-name, with no config-dir surgery and no need to strip skills
out of their plugin. Roles pass `--plugin-dir <mounted kipu plugin>` and invoke by capability or
by-name. The personal-artifact bind-mount (spike 11) is proven-equivalent and stays available as a
fallback, but is **not needed** — direct plugin mount is the primary path.

Consequences for the build:
- A role that references a plugin skill **by name** must use the qualified form `kipu-all:<skill>`
  (e.g. `kipu-all:kipu-spec-review`). Capability firing needs no name.
- The mounted plugin dir needs only `.claude-plugin/plugin.json` + `skills/`; MCP servers and
  `userConfig` in the real `plugin.json` are irrelevant to skill discovery and can be omitted or left
  inert (they don't block skill loading).

## Reproduce

```
ANTHROPIC_API_KEY=… bash run.sh
```

Builds four fresh throwaway repos in-container, runs each case, writes `out/stream-<case>.jsonl`,
`out/err-<case>.txt`, `out/effect-<case>.txt`, prints the evidence summary.

## Raw artifacts (in `out/`)

`stream-{plugin,personal}-{capability,byname}.jsonl`, matching `err-*.txt` and `effect-*.txt`;
the test plugin under `plugin/`.
