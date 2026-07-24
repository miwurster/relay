# 02 — Spike: plugin (marketplace) skills invoke headless under `-p`

**What to build:** A spike confirming that the real kipu-* *plugin* (marketplace) skills fire from a headless in-sandbox subagent under `-p` — via capability (auto-fire as the `Skill` tool) and/or by-name. Wayfinder spike 11 proved all three paths for *personal* artifacts only; the spec requires the build to confirm plugin skills. The result sets whether roles mount plugin skills directly or fall back to the proven personal-artifact bind-mount into `~/.claude/skills/<name>`.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A kipu-* plugin skill is invoked headless in-sandbox with two-way evidence (stream-json + effect)
- [x] Capability auto-fire and by-name paths each tested for a plugin skill
- [x] Decision recorded: mount plugin skills directly, or fall back to personal-artifact mounts

## Answer

**PROVEN — mount plugin skills directly via `--plugin-dir`.** The real `kipu-commit` plugin skill (verbatim from the installed `kipu-all`), delivered by a session-scoped `claude --plugin-dir <dir>` mount, is discovered and invoked as the `Skill` tool by headless `claude --print` inside the CI-parity `sandcastle:qc-catalog` sandbox — **both** by capability and by-name. Two-way evidence per run: a `Skill` tool_use event in stream-json **and** a real Conventional-Commits commit landing in a throwaway repo (kipu-commit runs autonomously). Exactly one Skill event/run, exit 0, clean stderr, across four cases.

Spike 11's plugin caveat is closed. No config-dir surgery needed; MCP servers / `userConfig` in the real `plugin.json` are irrelevant to skill discovery and can be omitted.

**One behavioural difference:** plugin-delivered skills fire under the **plugin-qualified** name `kipu-all:kipu-commit`; personal skills fire under the bare `kipu-commit`. A role invoking a plugin skill *by name* must use the qualified form (`kipu-all:<skill>`); capability firing needs no name. The spike-11 personal-artifact bind-mount is proven-equivalent and stays available as a fallback, but is not needed.

Evidence + reproduction: `.scratch/relay-build/research/spike-02-plugin-skills/` ([FINDINGS.md](../research/spike-02-plugin-skills/FINDINGS.md), `run.sh`, `out/stream-*.jsonl`).
