# Credential and secrets flow for a distributed tool

Type: grilling
Status: open
Blocked by: —

## Question

How do secrets reach a tool run via `npx` in an arbitrary repo, and who talks to Jira?

Context: the spike keeps the Jira token host-side (never in the container) and injects read-context into the prompt; the sandbox holds `GITLAB_TOKEN` + `ANTHROPIC_API_KEY`. ADR-0004 proved headless Atlassian MCP auth via a service-account bearer token (`ATLASSIAN_SA_TOKEN`) pinned to a cloudId.

Decide:

- Host-owns-Jira (TS REST client, as the spike) vs Jira-via-MCP in the sandbox (ADR-0004) — or a split (host selects/claims, subagents read via MCP)?
- Where secrets live for a distributed tool — env vars, a per-repo `.sandcastle/.env`, a home-dir config? No secret in the package.
- Which identity comments/transitions Jira (operator vs service account)?
