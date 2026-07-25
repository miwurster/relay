# 05 — Jira host client + selection + type guard (Seam 1)

**What to build:** Host-side work-item resolution. Using a single service-account identity over Jira REST (basic-auth, pinned cloudId, Jira-only), relay resolves exactly one work-item key. No argument → frontier JQL narrowed to `issuetype in (Story, Bug, Vulnerability)`, ordered priority DESC / created ASC, first wins. Explicit key → same eligibility gates, no override; any gate failure breaks the pass. A Task (auto or explicit) exits 2. Repo scope comes from `docs/agents/issue-tracker.md`, not the git remote. This resolves a key (or exits) without running a pass.

**Blocked by:** 03

**Status:** resolved

- [x] Auto-pick JQL narrowed to Story / Bug / Vulnerability, ordered priority DESC / created ASC (`frontierJql`, `src/work-item.ts`) — ordering is Jira's, so the first candidate whose blockers are all done wins
- [x] Explicit key held to the same gates with no override; failure breaks the pass as a `SelectionError` → exit 2
- [x] Task as auto-pick candidate excluded by the JQL; Task as explicit param → `SelectionError` → exit 2
- [x] Empty frontier resolves cleanly to nothing-to-do → exit 0
- [x] Repo scope sourced from `issue-tracker.md` (`src/tracker-doc.ts`), never the git remote
- [x] Tested against a fake Jira client (no sandbox, no network); the REST client's field mapping is tested against a stubbed `fetch`

**Build notes:**

- **Gate failures exit 2, not 1.** Exit 1 is a *pass outcome* (mid-block, under-spec bail). Selection runs before any pass starts, so an ineligible key — wrong type, wrong repo, not `ready-for-agent`, `agent-running`, done, or blocked — is an error exit like Task-as-param.
- **Tracker constants are parsed, not prose-matched.** The host reads only the `## Setup constants` bullets (`- **Jira project key:** \`PSD\``, `- **Repo label:** \`repo:qc-catalog\``). The doc's prose frontier query is *not* parsed — relay builds the JQL from the scope it read, which is what "frontier JQL narrowed to…" asks for.
- **cloudId is not read host-side.** Host REST authenticates with basic auth against `jira.baseUrl`, so the pinned cloudId buys nothing here; it is the sandbox MCP's parameter and is read by ticket 06 when the MCP config is written.
- **Blockers come from native "is blocked by" links only.** qc-catalog's `Blocked by:` description-line fallback (for projects with no blocking link type) is not implemented — no target repo uses it.
- **Search pages through the whole frontier.** With a single page, a frontier where every returned candidate is blocked would look like nothing-to-do and silently exit 0.
- **`runPass` takes no injected client.** The seam under test is `selectWorkItem(client, scope, workItem)`; `runPass` only wires config + secrets + scope into the REST client, and ticket 07 replaces it with the harness.
