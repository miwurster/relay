# 04 — Doctor says which gate a pass will run

**What to build:** an operator runs `relay doctor` and is told, before any **pass**, which command relay will verify their branch with — and warned when relay had to guess it.

With the config field gone, **doctor** is the only place an operator can find this out ahead of time. Its new gate check runs the **gate resolver** and reports the answer: a `declared` gate is fine, an `inferred` one is a warning. A warning is a new verdict for doctor, and deliberately does not fail the run — an undeclared gate is imperfect, not broken. Together with the **handover**'s provenance line, this warning is the whole replacement for the sentinel's loud refusal.

The check reaches the resolver through an injectable probe, alongside the existing docker and `gh` runners, so no doctor test opens a sandbox or spends a session. The default probe opens a sandbox, runs the resolver, and deletes the branch it used — a branch named off the configured prefix, not any **pass branch**. That deletion is a deliberate exception to relay's never-delete rule and needs the reason written at the call site: the rule protects a branch that may carry commits worth a human's time, and the probe's one leg is forbidden from committing, so the real hazard would be reusing the branch across runs.

**Blocked by:** 03.

**Status:** resolved

- [x] Doctor reports a gate check naming the resolved command and where it came from.
- [x] A declared gate is reported as ok; an inferred one as a warning.
- [x] A warning prints distinctly from ok and from failed, and on its own leaves doctor's exit code at 0.
- [x] A failed config, secrets or image check leaves the gate check skipped rather than crashing the run, and the checks after it still report.
- [x] The probe is injectable in the same shape as the existing docker and `gh` runners, and no test opens a sandbox.
- [x] The default probe disposes of its sandbox and deletes its own branch, so doctor can be run twice in a row.
- [x] The probe never uses a pass branch name.
- [x] `npm run verify` exits zero.
