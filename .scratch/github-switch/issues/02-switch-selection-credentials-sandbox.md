# 02 — Switch selection, credentials and the sandbox over; delete Jira

**What to build:** relay picks a real **work item** from GitHub and opens a **sandbox** for it, with one credential and no Atlassian MCP.

This is the contract half of the expand–contract: the module 01 added becomes the only tracker, and everything Jira-shaped is deleted rather than left dormant.
None of these pieces compile without the others, which is why they are one ticket.

The **eligibility check** becomes: labelled `ready-for-agent`; not **held** (`agent-in-progress`); state open; no **open blocker**.
The runnable-type and repo-label gates are deleted outright.
One eligibility function still decides both the auto-pick and an explicitly-named item, so the two can never disagree.

**Open-blocker filtering is relay's own**, and lives in the eligibility check: the client reports blockers with their state and eligibility keeps the open ones.
A blocked-by *count* must never be trusted — GitHub's includes closed blockers.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] An auto-pick takes the longest-waiting eligible item; an empty frontier is a clean nothing-to-do, not a failure.
- [ ] Each gate is covered at the high seam with a faked client: the ready label, the `agent-in-progress` hold, a closed issue, and an open blocker.
- [ ] A **closed** blocker is ignored, so a finished dependency does not hold work back forever.
- [ ] A blocker in **another repository** is honoured, identified from its `url`.
- [ ] An explicitly-named item faces the same gates with no override, and each failure names the gate it failed.
- [ ] `TrackerScope` and the tracker doc's setup-constant parser are gone. The tracker-doc module keeps only the doc's path and an existence check, so a missing doc still fails the pass early with a clear error.
- [ ] `Secrets` is one GitHub token plus the Claude credential. The Atlassian pair and the GitLab token are gone; the home-dir file, environment-variable precedence and the single aggregated error are unchanged.
- [ ] The sandbox environment carries the token as `GH_TOKEN` — not `GITHUB_TOKEN` — and no Atlassian or GitLab variable. The token is never written to the sandbox's disk.
- [ ] The Atlassian MCP config generation, its temp directory, its bind mount and its teardown are all deleted.
- [ ] The repo config schema has no `jira` block, and because it is strict, a leftover one fails loudly with a message an operator can act on.
- [ ] The crash comment says the item is left labelled `agent-in-progress`, not "In Progress".
- [ ] The Jira module and its tests are deleted, and `npm run verify` exits zero.
