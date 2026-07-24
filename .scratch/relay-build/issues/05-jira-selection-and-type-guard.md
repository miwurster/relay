# 05 — Jira host client + selection + type guard (Seam 1)

**What to build:** Host-side work-item resolution. Using a single service-account identity over Jira REST (basic-auth, pinned cloudId, Jira-only), relay resolves exactly one work-item key. No argument → frontier JQL narrowed to `issuetype in (Story, Bug, Vulnerability)`, ordered priority DESC / created ASC, first wins. Explicit key → same eligibility gates, no override; any gate failure breaks the pass. A Task (auto or explicit) exits 2. Repo scope comes from `docs/agents/issue-tracker.md`, not the git remote. This resolves a key (or exits) without running a pass.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Auto-pick JQL narrowed to Story / Bug / Vulnerability, ordered priority DESC / created ASC
- [ ] Explicit key held to the same gates with no override; failure breaks the pass
- [ ] Task as auto-pick candidate excluded; Task as explicit param → exit 2
- [ ] Empty frontier resolves cleanly to nothing-to-do
- [ ] Repo scope sourced from `issue-tracker.md`
- [ ] Tested against a fake Jira client (no sandbox, no network)
