# 05 — The setup checklist and the init tickets follow

**What to build:** an operator following `docs/migrating-a-repo-to-relay.md` is told to declare their **green gate** in `AGENTS.md`, and never told to put it in a config file that no longer accepts it.

The checklist and the `relay-init` effort's tickets both still describe a detected-and-confirmed gate. Left alone they teach a setup that fails.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] The migration checklist's gate step is declaring the command in `AGENTS.md`, and its config section names no gate field.
- [ ] The checklist says what `relay doctor`'s gate warning means and what to do about it.
- [ ] `.scratch/relay-init/issues/01-green-gate-sentinel.md` is `wontfix`, with a comment naming ADR-0009 as why.
- [ ] `.scratch/relay-init/issues/02-init-writes-the-config.md` has its gate-detection, sentinel and confirm-comment criteria struck, and its config-contents criterion reduced to `defaultBranch`.
- [ ] No remaining doc or ticket in the repo tells an operator to configure a gate.
- [ ] `npm run verify` exits zero.
