# Spike 11 — headless skill invocation under `claude --print -p`

**Verdict: PROVEN.** A personal skill placed in `~/.claude/skills/<name>` is auto-discovered and invoked (as the `Skill` tool) by claude-code running headless (`claude --print`), **invoked by capability** — no slash command. Confirmed both at the bare-CLI level and inside the exact CI-parity Docker image with the skill **bind-mounted read-only**.

Date: 2026-07-24. claude-code 2.1.218. Model used for the runs: `claude-haiku-4-5-20251001` (behavior is discovery-layer, model-independent).

## The skill under test

`config/skills/cave-echo/SKILL.md` — frontmatter `name: cave-echo` + a capability `description`; body instructs a distinctive marker `CAVE-ECHO-FIRED::<phrase>::END`. The marker makes the effect unmistakable *and* the stream carries the `Skill` tool_use event, so firing is proven two independent ways (event + effect), not just "output looked right".

Prompt (capability, never a slash): `Please echo this phrase back to me in cave-speak: <phrase>`

## Step A — bare CLI, isolated config dir

```
CLAUDE_CONFIG_DIR=<spike>/config claude --print --output-format stream-json --verbose \
  --permission-mode bypassPermissions --model claude-haiku-4-5-20251001 \
  "Please echo this phrase back to me in cave-speak: hello-world-42"
```

Evidence (`stream-A.jsonl`):

```
"name":"Skill","input":{"skill":"cave-echo","args":"hello-world-42"}
CAVE-ECHO-FIRED::hello-world-42::END
```

The `Skill` tool_use names the discovered skill and passes the phrase as args; the marker is emitted. `~/.claude/skills` is just the default `$CLAUDE_CONFIG_DIR/skills`, so relocating the config dir tests the identical discovery path.

## Step B — docker fidelity, bind-mounted read-only

Exact CI-parity image `sandcastle:qc-catalog` (native `claude` binary via install.sh, `agent` user, home `/home/agent`). Skill bind-mounted **read-only** to the default location — the production mount surface:

```
docker run --rm -e ANTHROPIC_API_KEY \
  -v <spike>/config/skills/cave-echo:/home/agent/.claude/skills/cave-echo:ro \
  --entrypoint bash sandcastle:qc-catalog \
  -c 'claude --print --output-format stream-json --verbose \
      --permission-mode bypassPermissions --model claude-haiku-4-5-20251001 \
      "Please echo this phrase back to me in cave-speak: docker-fidelity-99"'
```

Evidence (`stream-B.jsonl`):

```
"name":"Skill","input":{"skill":"cave-echo","args":"docker-fidelity-99"}
CAVE-ECHO-FIRED::docker-fidelity-99::END
```

Read-only bind-mount does not impede discovery; native binary in-image behaves identically to the host CLI.

## Slash-expansion — also works headless (follow-up)

The qc-catalog prototype (`shared/sandbox.ts:48`) recorded that the **`/implement` slash command did not expand** headless, and thereafter inlined the implement method. A follow-up battery tested slash directly and **contradicts that**:

- **Step C/D** — `/cave-echo <phrase>` (bare + docker): marker fired, **no `Skill` tool_use event** → the skill body was injected by client-side slash expansion, not a tool call.
- **Step E** — `/cavecmd zzz-123` (custom command `commands/cavecmd.md`): marker fired, **zero tool_use** → pure prompt expansion.
- **Step F** — control "run the cavecmd command…" (no slash): fired via the **`Skill`** tool → cavecmd was still model-invocable by name, so E alone didn't isolate slash.
- **Step G** — `/cavelock lock-777` with frontmatter `disable-model-invocation: true`: marker fired, **zero tool_use**.
- **Step H** — control "run the cavelock command…" (no slash): **no marker** (model flailed to Bash) → cavelock is genuinely non-model-invocable, so **G's firing can only be literal slash expansion**.

**Conclusion: `claude -p "/name args"` expands headless** in claude-code 2.1.218 — client-side, before the model, independent of any tool. The prototype's "did not expand" note is **stale** (earlier claude version) or `/implement` was not actually present in `~/.claude` at the time.

Three delivery paths, all proven headless:

| Path | Prompt shape | Mechanism | Steps |
|------|--------------|-----------|-------|
| Slash expansion | `/name args` | client-side inject, no tool event | C, D, E, G |
| Capability | plain task matching `description` | model fires `Skill` tool | A, B |
| By-name | "run the X skill/command" | model fires `Skill` tool (suppressible via `disable-model-invocation`) | F |

## Caveat — personal vs plugin artifacts

Every artifact tested here is a **personal** skill/command living directly under the config dir (`~/.claude/skills`, `~/.claude/commands`). The real relay skills (`kipu-code-review`, `kipu-spec-review`, `kipu-commit`, `kipu-implement`) are **plugin marketplace** skills; plugin discovery/exposure under `-p` was **not** tested and could differ. The build must re-verify with an actual kipu plugin skill before relying on any one path.

## Consequence for ticket 07

The earlier "never slash — capability only" rule is **relaxed**: slash expansion is a viable, tool-free delivery path headless, alongside capability. No fallback lever needed (`CLAUDE_CONFIG_DIR` / `--plugin-dir` untested — unnecessary). Ticket 07 can choose per role between (a) slash-expanding a mounted command verbatim and (b) capability-invoking a mounted skill — subject to the plugin caveat above.

## Raw artifacts

`stream-A.jsonl`, `stream-B.jsonl`, `err-A.txt`, `err-B.txt`, `config/skills/cave-echo/SKILL.md` — all in this directory.
