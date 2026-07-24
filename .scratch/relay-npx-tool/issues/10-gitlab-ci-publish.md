# GitLab CI build + publish pipeline

Type: task
Status: resolved
Blocked by: 08

## Question

What is the `.gitlab-ci.yml` that builds and publishes `@quantum-hub/relay` to the NPM registry using kipu shared components?

Reference: `qhub-api/.gitlab-ci.yml` already uses `gitlab.com/kipu-all/commons/pipeline-components/{compile-typescript,publish-npm,semantic-release}` (that repo has separate `python/` + `typescript/` dirs; this tool is a single TS package).

Decide / produce:

- The stages + `include` components for a single-package TS repo (compile-typescript, semantic-release, publish-npm, oss-compliance).
- `project-dir` layout, `.releaserc.json`, and how the `@quantum-hub` scope + registry auth are configured for publish.
- Any tag/runner inputs (the reference pins `kubernetes` / `cluster`).

Depends on ticket 08 (package layout).

## Answer

Mirror `qhub-api/.gitlab-ci.yml` **minus the `python/`+`typescript/` split** — relay is one TS package at the repo root, so every component's `project-dir` stays at its default `.` and both Python components drop out. All three `kipu-all/commons/pipeline-components` templates were read verbatim; the pipeline below is a direct reduction of the proven reference.

### `.gitlab-ci.yml` (repo root)

```yaml
stages:
  - commit-test
  - compliance
  - commit-release-check
  - release-package

include:
  - component: gitlab.com/kipu-all/commons/pipeline-components/compile-typescript@main
    inputs:
      tags: [kubernetes, cluster]
  - component: gitlab.com/kipu-all/commons/oss-compliance/oss-compliance-check@v1.6.3
    inputs:
      tags: [kubernetes, cluster]
  - component: gitlab.com/kipu-all/commons/pipeline-components/semantic-release@main
    inputs:
      tags: [kubernetes, cluster]
  - component: gitlab.com/kipu-all/commons/pipeline-components/publish-npm@main
    inputs:
      tags: [kubernetes, cluster]
```

No `project-dir` overrides (default `.`). No `install-uv` (that flag exists only for the Python side; default `false`). `tags: [kubernetes, cluster]` on every component mirrors the reference's runner selector.

### Flow (what the stages chain into)

Which jobs run depends on the pipeline trigger — each component carries its own `rules` (all fetched verbatim):

**Branch / MR pipeline** (feature push, MR):
1. **commit-test** — `compile-typescript` (`rules: $CI_COMMIT_BRANCH`, **no tag rule**) runs `npm ci` → `npm run lint` → `npm run test` → `npm run build`. Relay's **own repo** CI green, distinct from the target-repo green-gate of ticket 06.
2. **compliance** — `oss-compliance-check` runs on MR/web/branch (FOSSA `analyze` + `test`).

**`main` pipeline** (after merge): as above **plus**
3. **commit-release-check** — `semantic-release` (`main`-only) analyzes Conventional Commits, writes the bumped `package.json`, commits it as `chore(release): v<x>`, cuts the GitLab release, and creates the **git tag**.

**Tag pipeline** (created by semantic-release): only the jobs whose rules match `$CI_COMMIT_TAG` run —
4. **compliance** — `oss-compliance-check` runs **again** (its **first rule is `if: '$CI_COMMIT_TAG'`**): FOSSA `analyze -r $CI_COMMIT_TAG` + `fossa test -r $CI_COMMIT_TAG`. This is the **gate before publish** — a non-compliant dependency license fails the tag pipeline in the `compliance` stage, and `publish-npm` (later stage) never runs. The published artifact is FOSSA-checked at its exact tag.
5. **release-package** — `publish-npm` fires on `$CI_COMMIT_TAG`: `npm ci` → `npm run build` → `npm publish`.

`compile-typescript` and `semantic-release` do **not** run on the tag pipeline (branch/main-only rules); both `compile-typescript` and `oss-compliance-check` skip `chore(release):` commits, so the release commit's own branch pipeline is a no-op — the tag pipeline carries compliance + publish.

### `.releaserc.json` (repo root)

Single-package variant of the reference — drops qhub-api's `@semantic-release/exec` + `update-version.sh` + `oclif` (those existed only to bump Python **and** TS in one repo). `@semantic-release/npm` with `npmPublish: false` bumps `package.json` **without** publishing (publish is the separate tag job).

```json
{
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/npm", { "npmPublish": false }],
    "@semantic-release/gitlab",
    ["@semantic-release/git", {
      "assets": ["package.json", "package-lock.json"],
      "message": "chore(release): v${nextRelease.version}\n\n${nextRelease.notes}"
    }]
  ],
  "branches": ["main"]
}
```

The `semantic-release` component's `before_script` globally installs `semantic-release @semantic-release/gitlab @semantic-release/git @semantic-release/exec oclif`; `@semantic-release/npm`, `commit-analyzer`, `release-notes-generator` ship inside `semantic-release` core, so no extra install is needed. `GITLAB_TOKEN` = `$CI_JOB_TOKEN` (component-provided) — no PAT.

### Scope + registry auth

- **Target registry: public npmjs** (`registry.npmjs.org`) — resolves the map's open "npmjs-vs-GitLab" question. Confirmed by the component's `id_tokens.NPM_ID_TOKEN` audience `npm:registry.npmjs.org`. Consumers run `npx @quantum-hub/relay`.
- **Auth = OIDC trusted publishing, no `NPM_TOKEN`.** `publish-npm` mints `NPM_ID_TOKEN` (npmjs) + `SIGSTORE_ID_TOKEN` (provenance); npmjs trades the OIDC token for publish rights. Confirms ticket 08's "no `~/.npmrc` prereq, package holds no secrets."
- **`@quantum-hub` scope** publishes as public via `package.json` `publishConfig: { "access": "public" }` (identical to qhub-api).

### Runner/tag inputs

`kubernetes`, `cluster` — verbatim from the reference. No other tag/runner tuning.

### Setup prerequisites (task facts later work depends on)

1. **npmjs trusted publisher** must be configured for `@quantum-hub/relay` pointing at this GitLab project + the `publish-npm` job — a one-time console step, done before the first tag pipeline, else publish 403s. (Alternative fallback if OIDC is unavailable: a masked `NPM_TOKEN` CI variable — not preferred; the whole point is no secret.)
2. **npm/Node version for OIDC**: trusted publishing needs npm ≥ 11.5. The component pins `image: node:lts`; if that node:lts still ships npm 10, override `publish-npm`'s `image` input to a node tag carrying npm ≥ 11.5. Build must verify the current `node:lts` npm version against the OIDC requirement.

### Deltas to record

- **Ticket 08 (packaging)** — `package.json` needs, beyond ticket 08's manifest: `scripts.lint` / `scripts.test` / `scripts.build` (build = `tsup` per 08), `publishConfig.access: "public"`, an Apache-2.0 `LICENSE` added to `files` (`["dist", "LICENSE"]`) for oss-compliance + npm norms, and a committed root `package-lock.json` (component uses `npm ci`). Confirms 08's public-npmjs + no-secret publish.
