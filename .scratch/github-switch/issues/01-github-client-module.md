# 01 — Add the GitHub client module alongside the Jira one

**What to build:** the host's read-and-comment slice of GitHub, working and tested, but not yet wired into a pass.

It answers three questions: what is on this repo's **frontier**, what is issue number N, and leave this comment on issue N.
The frontier is this repo's open issues labelled `ready-for-agent`, longest-waiting first, each carrying its number, state, labels, blocked-by entries **with their state**, and its sub-issues.

This is the prefactor for ticket 02: adding the module beside the Jira one keeps every existing test green, so 02 becomes a switch-over rather than a rewrite.
Nothing consumes this module when the ticket lands, and the Jira module is untouched.

It shells out to `gh` through an injected runner defaulting to the real one, mirroring how the docker host module exports both its runner type and the real implementation.
There is no REST client and no `fetch`.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The frontier is fetched in **one** runner call, whose `--json` field list names fields `gh` actually supports.
- [x] Blocked-by entries carry state, mapping `gh`'s upper-case `"OPEN"`/`"CLOSED"` correctly. No filtering happens here — that is eligibility's job in 02.
- [x] A blocked-by entry is attributed to its repository from its `url`, because the `repository` field `gh` requests never appears in output. A cross-repo blocker is not dropped.
- [x] Sub-issues come back sorted by number, since their order is undocumented and empirically insertion order.
- [x] Fetching an issue that does not exist or is not visible yields `undefined` rather than throwing — "no such issue" is an answer.
- [x] A `gh` failure surfaces as the module's own error type, naming what was attempted.
- [x] Any dependency-edge write goes through `gh issue edit --add-blocked-by`. A test asserts **no** call targets a `dependencies` REST endpoint, because that endpoint takes a numeric database id and silently links an unrelated repository's issue when handed a number.
- [x] The module's tests fake the runner, assert on argument lists, and answer with canned `gh` JSON. Prior art: the doctor tests' faked docker runner.
- [x] `npm run verify` exits zero, with the Jira module and all its tests still present and passing.
