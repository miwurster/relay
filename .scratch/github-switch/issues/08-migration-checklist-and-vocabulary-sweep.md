# 08 — Migration checklist and the vocabulary sweep

**What to build:** a target repo can migrate to GitHub-era relay by following a list, and nothing anywhere still says Jira or GitLab.

The checklist is operator-facing, because a target repo cannot migrate by guessing:

- replace the repo's agent-facing issue-tracker doc with the GitHub one;
- install `gh` in place of `glab` in the repo's sandbox Dockerfile;
- delete the `jira` block from the repo config;
- create the label vocabulary the passes depend on — `ready-for-agent`, `agent-in-progress`, `agent-in-review`, `agent-blocked`;
- provision one fine-grained token with `Issues: write` (which covers sub-issues, dependencies, issues and labels alike), `Pull requests: write`, `Contents: write` and `Metadata: read`, and set it as `GH_TOKEN`.

The sweep is the closing act of the hard switch.
A half-switch that leaves the old vocabulary lying around leaves every reader guessing whether a mention is dead or load-bearing, which is the failure this ticket exists to prevent.

**Blocked by:** 05, 06, 07.

**Status:** resolved

- [x] The migration checklist is committed where a target-repo operator will find it, and names every step above.
- [x] `git grep -i 'jira\|gitlab\|glab\|merge request'` returns nothing outside `docs/adr/` and `.scratch/`, where the history is supposed to mention them.
- [x] No `Tracker` or `Forge` interface exists, and one module is the only thing that talks to the tracker host-side — the property ADR-0007 is confirmed by.
- [x] The glossary, the ADRs and the code agree: the terms **Frontier**, **Ticket**, **Eligibility check**, **Open blocker**, **Held** and **Tracker doc** describe what the code now does.
- [x] `npm run verify` exits zero.
