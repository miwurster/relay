# 02 — Spike: plugin (marketplace) skills invoke headless under `-p`

**What to build:** A spike confirming that the real kipu-* *plugin* (marketplace) skills fire from a headless in-sandbox subagent under `-p` — via capability (auto-fire as the `Skill` tool) and/or by-name. Wayfinder spike 11 proved all three paths for *personal* artifacts only; the spec requires the build to confirm plugin skills. The result sets whether roles mount plugin skills directly or fall back to the proven personal-artifact bind-mount into `~/.claude/skills/<name>`.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A kipu-* plugin skill is invoked headless in-sandbox with two-way evidence (stream-json + effect)
- [ ] Capability auto-fire and by-name paths each tested for a plugin skill
- [ ] Decision recorded: mount plugin skills directly, or fall back to personal-artifact mounts
