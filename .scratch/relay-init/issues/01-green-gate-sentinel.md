# 01 — An unset green gate refuses to load

**What to build:** an operator whose **green gate** could not be detected finds out the moment they run anything, with a message telling them what to fix.

The config schema accepts any non-empty string for `greenGate`, so there is no way to write "not set yet" into a `relay.config.ts` without it becoming a command relay will happily run as the sole evidence for calling a branch green. **Init** needs exactly that: a value it can write when detection fails, which cannot be mistaken for a confirmed gate.

A known sentinel constant fills the hole. The schema refuses it by name, with a message saying init left the gate unset and the operator has to fill it in. Because the refusal lives in the schema, both a real **pass** and **doctor** report it with no further work — doctor gains no new check, its existing config check just goes red.

Nothing writes the sentinel yet. This is the prefactor that makes init's undetectable case safe.

**Blocked by:** None — can start immediately.

**Status:** wontfix

**Why:** [ADR-0009](../../../docs/adr/0009-the-repos-docs-declare-the-green-gate.md) took the green gate out of `relay.config.ts` altogether — the repo's own docs declare it, and relay reads it from there.
A config field that no longer exists cannot carry a sentinel, so the hole this ticket filled is gone rather than fixed.
The guarantee it bought — relay never runs a command nobody chose — is given up deliberately, and replaced by visibility: doctor's `gate` warning before a pass, and the handover's provenance line after one.

- [x] A sentinel constant is exported from the config module for init to write later.
- [x] Loading a `relay.config.ts` whose `greenGate` is the sentinel fails with a message that names init as its origin and says to fill the gate in — not a generic schema error.
- [x] A config carrying any other non-empty gate still loads exactly as before.
- [x] Doctor reports a sentinel-carrying config as a failed config check, through its existing check rather than a new one, and still runs the checks that follow.
- [x] `npm run verify` exits zero.
