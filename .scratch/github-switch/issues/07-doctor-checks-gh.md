# 07 — `relay doctor` checks `gh` on the host

**What to build:** an operator learns their host is missing `gh` from **doctor**, not from a failed pass.

`gh` is a host prerequisite now, alongside Docker: the host resolves the work item through it.
Doctor reports whether it is installed and whether it is authenticated, as two facts rather than one, since a present-but-unauthenticated `gh` is the more likely failure and the fix differs.

It follows the existing pattern: run every check eagerly and report them all, so a missing tool and an unresolvable credential are found together.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Doctor reports `gh` installed, and separately whether it is authenticated.
- [ ] A missing or unauthenticated `gh` is a failed check with an actionable detail, and doctor exits non-zero without skipping later checks.
- [ ] A healthy setup reports the `gh` check as ok alongside the rest.
- [ ] The check is faked in tests the way the docker runner already is — no real `gh` invocation.
- [ ] `npm run verify` exits zero.
