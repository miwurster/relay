# 04 — Config loader + secrets (Seam 3)

**What to build:** The typed config surface the harness reads. `relay.config.ts` (repo root) is loaded by the compiled JS harness through a bundled `jiti` / `bundle-require` loader and validated with zod: green-gate command, default branch, optional `image` ref, `dockerfile` path, URL env-var defaults. Secrets are read from `~/.config/relay/.env` (env-var overridable), never from the package: SA Jira token, `GITLAB_TOKEN`, Claude creds. A malformed config or a missing required secret fails fast with exit 2.

**Blocked by:** 03

**Status:** resolved

Landed on main in `4004f76 feat(relay): load typed config and resolve secrets`.

- [x] `relay.config.ts` loaded via jiti and zod-validated (`src/config.ts`); jiti is anchored at the config file so the target repo's own imports resolve
- [x] Package defaults applied and overridable (branch prefix `agent/`, 45m timeout, per-role model map — ticket 07's nine roles)
- [x] Secrets resolved from `~/.config/relay/.env` with env-var override (`src/secrets.ts`); XDG-aware, all missing secrets reported at once
- [x] Malformed config or missing secret → `ConfigError` → exit 2, fail-fast at the top of `runPass`
- [x] Non-secret ids stay out of config — the schema is strict, so a `projectKey` / `cloudId` / token in `relay.config.ts` is rejected

**Build note:** a typed `defineConfig` authoring helper was built and then dropped — an `npx`-run tool leaves no resolvable dependency for the target repo's `relay.config.ts` to import from, and ticket 08 locks the package to a single `bin` with no library surface. `relay.config.ts` exports a plain object; the schema is the contract.

**From spike 01** (`.scratch/relay-build/spike-01/FINDINGS.md`): the spike hit a GCP ADC dependency in qc-catalog's test context (`serviceExecutionMetricsProvider`). Decision: **no gate-side secret injection** — qc-catalog will be fixed to run its tests without GCP, so the green gate needs no ADC provisioning.
