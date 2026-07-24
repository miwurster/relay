# 15 — GitLab CI build + publish pipeline

**What to build:** The `.gitlab-ci.yml` that builds and publishes `@quantum-hub/relay` via the kipu commons pipeline components — qhub-api's pipeline minus the python/typescript split (single package at root, every component's `project-dir` default `.`). Branch: `compile-typescript` (ci → lint → test → build) + `oss-compliance-check@v1.6.3` (FOSSA). main: `semantic-release` (bumps `package.json`, `chore(release)` commit, cuts tag) using `@semantic-release/npm` with `npmPublish:false`. Tag: `oss-compliance-check` again as the gate (first rule `$CI_COMMIT_TAG`) → `publish-npm` (build + `npm publish`). Publish target is public npmjs via OIDC trusted publishing — no `NPM_TOKEN`. All jobs `tags: [kubernetes, cluster]`.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Branch pipeline: compile-typescript + oss-compliance-check
- [ ] main pipeline: semantic-release bumps only (`npmPublish:false`), cuts tag
- [ ] Tag pipeline: oss-compliance gate → publish-npm via OIDC (no NPM_TOKEN)
- [ ] `package.json` gains `lint`/`test`/`build` scripts + `publishConfig.access:public`; Apache-2.0 LICENSE in `files`; root `package-lock.json` committed
- [ ] All jobs `tags: [kubernetes, cluster]`
- [ ] Setup prereqs recorded: npmjs trusted-publisher for `@quantum-hub/relay`; verify `node:lts` npm >= 11.5 for OIDC
