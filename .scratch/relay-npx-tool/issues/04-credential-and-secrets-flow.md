# Credential and secrets flow for a distributed tool

Type: grilling
Status: resolved
Blocked by: —

## Question

How do secrets reach a tool run via `npx` in an arbitrary repo, and who talks to Jira?

Context: the spike keeps the Jira token host-side (never in the container) and injects read-context into the prompt; the sandbox holds `GITLAB_TOKEN` + `ANTHROPIC_API_KEY`. ADR-0004 proved headless Atlassian MCP auth via a service-account bearer token (`ATLASSIAN_SA_TOKEN`) pinned to a cloudId.

Decide:

- Host-owns-Jira (TS REST client, as the spike) vs Jira-via-MCP in the sandbox (ADR-0004) — or a split (host selects/claims, subagents read via MCP)?
- Where secrets live for a distributed tool — env vars, a per-repo `.sandcastle/.env`, a home-dir config? No secret in the package.
- Which identity comments/transitions Jira (operator vs service account)?

## Answer

Resolved by grilling, 2026-07-23.

**Who talks to Jira — split (host picks, agent does the rest):**

- **Host harness (TS REST client):** picks the *one* work-item key only — the frontier JQL / explicit-key gates + type guard from ticket 03. Nothing else.
- **In-sandbox planner agent (Atlassian MCP):** receives that key, then reads the story, decomposes/orders the work, transitions the ticket to **In Progress**, drives the per-task loop, comments, transitions to **In Review**, and selects the next task. All Jira read + write + transition happens in-sandbox via MCP.

**Identity — a single service account, end to end:**

- Host pick authenticates as the SA (email + API token, REST basic auth).
- Sandbox authenticates as the SA (bearer `ATLASSIAN_SA_TOKEN`, pinned to cloudId `35183b42-c98a-4cd0-a8a7-32a27ea7856e`, Jira toolset only, English locale — the ADR-0004 setup).
- All Jira attribution is the relay service account. The operator identity is unused (the `assignee = currentUser()` multi-operator seam was an ADR-0004 *loop* concern; the loop is out of scope).

**Secrets — home-dir config with env-var override:**

- Secrets live in a home-dir file (e.g. `~/.config/relay/.env`, XDG); environment variables take precedence for CI / one-off runs. **No secret ships in the published package.**
- The file holds: the SA Jira token (+ SA email), `GITLAB_TOKEN`, and Claude creds (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
- Non-secret identifiers (cloudId, project key, repo label) stay in the target repo's `docs/agents/issue-tracker.md` — config, not secrets. This splits the two axes cleanly: **non-secret repo config travels with the repo; secrets travel with the machine.**

**Secret → destination map:**

- SA Jira token: used host-side (REST pick) **and** injected into the sandbox as the MCP bearer.
- `GITLAB_TOKEN` + Claude creds: injected into the sandbox only (git push + `glab`; the agent).
- This **reverses the spike's "Jira token never enters the container"** — deliberate, because the agent now talks Jira via MCP.

**Build-time notes (not decisions):**

- Verify that one SA API token serves both the REST basic-auth form and the MCP bearer form (ADR-0004 used it as the bearer; REST wants `email:token`).
- The planner-as-persistent-in-sandbox-loop-driver flow the operator sketched is captured in **ticket 07** as pre-seeded input. It reshapes ticket 03's host-side-planner / `Output.object` / per-ticket-loop framing on the host-vs-sandbox axis — reconcile in ticket 07, not here.
