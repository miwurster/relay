# 04 — Config loader + secrets (Seam 3)

**What to build:** The typed config surface the harness reads. `relay.config.ts` (repo root) is loaded by the compiled JS harness through a bundled `jiti` / `bundle-require` loader and validated with zod: green-gate command, default branch, optional `image` ref, `dockerfile` path, URL env-var defaults. Secrets are read from `~/.config/relay/.env` (env-var overridable), never from the package: SA Jira token, `GITLAB_TOKEN`, Claude creds. A malformed config or a missing required secret fails fast with exit 2.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `relay.config.ts` loaded via jiti/bundle-require and zod-validated
- [ ] Package defaults applied and overridable (branch prefix, 45m timeout, per-role model map)
- [ ] Secrets resolved from `~/.config/relay/.env` with env-var override; none read from the package
- [ ] Malformed config or missing secret → exit 2 (cheap fail-fast)
- [ ] Non-secret ids stay out of config (live in `issue-tracker.md`)
