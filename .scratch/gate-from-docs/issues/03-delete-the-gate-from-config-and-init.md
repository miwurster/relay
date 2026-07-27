# 03 — The gate leaves the config and init

**What to build:** an operator setting a repo up for relay is never asked about the **green gate** — no field to author, no detected guess to confirm, no sentinel to fill in.

The pass already reads the gate from the docs, so the config field is now a second place for the same fact to rot in. It goes, and the whole sentinel mechanism goes with it: this ticket reverts commit `a268934 feat(config): refuse a green gate init left unset`.

**Init** loses its gate detection at the same time — it must, because it imports the sentinel constant, so config and init cannot be split without a red tree between them. Init writes `defaultBranch` alone, and its report replaces "confirm the detected green gate" with declaring it in `AGENTS.md`, still ending on `relay doctor` as the next command.

No migration handling: no repo has a config with this field in it.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] The config schema has no gate field, and the sentinel constant and its refusal are gone.
- [ ] The schema stays strict, so a config carrying the old field is refused — with no special-cased message, because no such repo exists.
- [ ] A minimal valid config is `defaultBranch` alone, and every fixture across the suites reflects that.
- [ ] Init detects no gate, and the config it writes carries `defaultBranch` and nothing else.
- [ ] The config init writes round-trips: loading it yields the branch, and no gate.
- [ ] Init's report tells the operator to declare their gate in `AGENTS.md` and names `relay doctor` as the next step.
- [ ] Doctor's config check no longer names a gate command it cannot know.
- [ ] `npm run verify` exits zero.
