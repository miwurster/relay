# 02 — The gate resolver reads the repo's docs

**What to build:** an operator declares their **green gate** once in `AGENTS.md`, and every **pass** verifies with that command — no config, no confirmation step.

A seventh **role** joins the **crew**. The **gate resolver** runs as the pass's first **leg**, reads the repo's own docs, and answers with the command plus its **provenance**. The harness stops building that answer from config and starts asking the resolver for it.

What the resolver's prompt instructs its **cold session** to do:

1. Read the root doc graph in order — `AGENTS.md`, then `CLAUDE.md`, then `README.md` — following `@`-includes, and stop at the first explicit statement of the command that must pass before a change is done. Per-directory `AGENTS.md` files are not read; the gate is repo-wide.
2. Confirm that command's target exists without running it — a script in the manifest, a target in the `Makefile`, a wrapper on disk.
3. When no doc declares one, or the declared one does not check out, infer a gate from the build manifest and say so in `source`. The ladder worth suggesting is Maven, then `uv`, then the manifest's `verify` / `ci` / `test` scripts.
4. End with its **tagged block**.

Inference is that session's judgement, not relay code. The resolver never blocks a pass.

**Blocked by:** 01.

**Status:** resolved

- [x] The resolver is a role of the crew, run by the harness as the pass's first leg — before the planner, and therefore before the **held** label.
- [x] It runs on its own entry in the per-role model map, defaulting to a cheap model, and an operator can override it like any other role's.
- [x] Its answer is read from a tagged block and validated; a missing or malformed block fails as a role error, never as a bad command.
- [x] A repo whose `AGENTS.md` declares a gate resolves to that command with provenance `declared` and a `source` naming the file.
- [x] A repo whose `CLAUDE.md` only `@`-includes `AGENTS.md` still resolves the declaration behind the include.
- [x] A repo declaring a command whose target does not exist falls through to inference, and `source` says that is what happened.
- [x] A repo whose docs declare nothing resolves to an inferred gate rather than blocking the pass.
- [x] The resolver may not commit, and is not failed for a worktree it did not dirty.
- [x] The resolved gate is what the gate loop runs, and it is resolved exactly once per pass.
- [x] An `early-bail` pass still resolved its gate first, since resolution precedes the planner.
- [x] Nothing in the pass reads the config's gate field any more.
- [x] `npm run verify` exits zero.
