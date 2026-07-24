# Per-repo configuration surface + green-gate discovery

Type: grilling
Status: resolved
Blocked by: —

## Question

What must a target repo tell the tool, and how does the tool learn the quality-gate command?

Context: the spike hardcodes `GL_PROJECT_PATH`, default branch, image name, and the Maven green-gate (`./mvnw checkstyle:check` + unit groups excluding e2e/migration/integration). A distributed tool run in the pilot repo needs a config surface even before generalizing.

Crossover — ticket 03 (resolved) already decided part of this surface: the planner **reads `docs/agents/issue-tracker.md`** for tracker access, **repo label / project key / cloud id, relation model, and issue-type mapping**, and repo scope is **sourced from that file, not derived from the git remote** (remote-derivation dropped, or fallback-only). This ticket must fit `issue-tracker.md` into the wider config surface (green-gate, default branch, image, timeouts, model) rather than re-open how the tracker config is read.

Decide:

- The config surface — a `.sandcastle/` config file in the target repo, env vars, or auto-derivation (git remote → project path + repo label, as the spike derives)?
- How the quality gate is discovered vs configured (for the Java/Maven pilot: reuse the spike's Maven commands; general discovery is out of scope).
- Default branch, branch-prefix, timeouts, model — defaults vs per-repo overrides.

## Answer

The config surface splits into **two per-repo files by reader**, plus package defaults, plus the runtime secrets file already settled in ticket 04.

### 1. Two config files, split by who reads them

- **`relay.config.ts`** (target repo root) — typed, zod-validated (ticket 02), read by the **TS harness** (host orchestrator).
  Being TS, it may reference env-var names inline for URL defaults, e.g. `jira.baseUrl: process.env.JIRA_BASE_URL ?? "https://kipu-quantum.atlassian.net"`.
  **No secrets live in it** — secrets are resolved at runtime from `~/.config/relay/.env` or real env vars (ticket 04; env var overrides the home file).
- **`docs/agents/issue-tracker.md`** — read by the **in-sandbox planner agent** as markdown: tracker access, project key, repo label, relation model, issue-type mapping.
  Untouched by this ticket; ticket 03 stands. The seam is clean: harness config is code, agent config is prose, no overlap.

### 2. Green gate — explicit command, not discovery

The quality gate is an **explicit command string in `relay.config.ts`**.
relay is **build-tool-agnostic**: it runs the command and reads the exit code — it carries no Maven/Java knowledge.
Auto-discovery is rejected (general discovery is out of scope), and a hardcoded Maven profile is rejected (would bake build-tool knowledge into relay and require a release to retune the pilot's gate).

**The final gate before publishing the MR = all tests except e2e.**
This diverges from the spike's three-tier exclusion (`!e2e & !migration & !integration`): **migration + integration tiers are now IN**, only e2e is excluded.
→ **Dependency pushed to ticket 09:** the local Docker sandbox image must be able to run the migration + integration tiers (DB / testcontainers), not just the unit tier.

### 3. Knob split — package defaults vs per-repo

- **Package-baked defaults (overridable):** branch-prefix (`agent/`), per-role run timeout (`45m`), and the **per-role model map** (below).
- **Per-repo in `relay.config.ts`:** default branch, image ref, green-gate command, URL env-var defaults.
- Dropped entirely for this tool: poll / pipeline / ci-fix constants — those belong to the out-of-scope outer loop.

**Model is per-role, not a single value.** Defaults mirror the `kipu-afk` + `kipu-implement` Model policy verbatim; each is overridable in `relay.config.ts`.

| Role | Default model | Escalation |
|---|---|---|
| planner | opus (`claude-opus-4-8`) | — |
| implementer | sonnet (`claude-sonnet-5`) | → opus when BLOCKED for want of reasoning |
| per-ticket fast review (code + spec) | opus (`claude-opus-4-8`) | — |
| fixer (both phases) | sonnet (`claude-sonnet-5`) | → opus when the fix needs it |
| whole-branch in-depth review (code + spec) | fable (`claude-fable-5`) | — |
| quality-gate | haiku (`claude-haiku-4-5`) | — |
| commit | haiku (`claude-haiku-4-5`) | — |
| MR / handover | sonnet (`claude-sonnet-5`) | — |

planner + quality-gate have no `kipu-afk` precedent (there the controller *is* the planner, on the session model) — set here: planner opus (every leg builds on it), quality-gate haiku (mechanical: run gate command, read exit code). The **authoritative role list** is ticket 07's (orchestration topology); this ticket locks the per-role *shape* and these defaults, and 07 may add/rename roles.

### 4. No GitLab coordinates in config

`relay.config.ts` carries **no GitLab fields**.
Handover is `kipu-mr` / `glab` (ticket 05), which derive project path + host from the checked-out git remote; relay runs inside the target repo's worktree, so the remote is present.
Not a conflict with ticket 03 — that moved the *Jira repo scope* off the remote; this is the *push target*, which `glab` owns anyway. One source of truth, no drift.

### 5. Validation — a `relay doctor` command, not every run

- **`relay doctor`** — full opt-in diagnostic a human runs to verify a repo is wired: `relay.config.ts` valid + `issue-tracker.md` present + secrets resolvable + `glab` authenticated + Docker reachable + image present/buildable.
- **A real run** does **cheap fail-fast only**: `relay.config.ts` parses / zod-valid + required secrets resolvable → else **exit 2** (ticket 05). Deep tool/auth/docker failures surface lazily where first used, still mapped to **exit 2**. No expensive upfront probing on every pass; no half-started pass from a bad config.

## Correction (from ticket 07, 2026-07-24)

Two changes to the per-role model map: the **`commit` row is removed** — there is no standalone commit role, commit folds into the implementer/fixer session via `/kipu-commit` (their model, sonnet); and **`quality-gate` moves haiku → sonnet** because the gate role now also triages failures to hand the fixer a diagnosis (reasoning work). Final map: planner opus, implementer sonnet, fixer sonnet, fast reviews opus, in-depth reviews fable, quality-gate sonnet, handover sonnet.
