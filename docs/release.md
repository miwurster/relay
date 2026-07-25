# Releasing relay

`@quantum-hub/relay` is built and published by `.gitlab-ci.yml` from the kipu commons pipeline components.
Everything is a single package at the repo root, so every component keeps its default `project-dir` of `.`.

## What runs when

**Branch / MR pipeline**

1. `commit-test` — `compile-typescript`: `npm ci`, then `npm run lint`, `npm run test`, `npm run build`.
   The repo carries no linter, so `lint` aliases `typecheck` (`tsc --noEmit`) to satisfy the component's fixed step.
2. `compliance` — `oss-compliance-check`: FOSSA `analyze` + `test`.

**`main` pipeline** — the two jobs above, plus:

3. `commit-release-check` — `semantic-release`: reads the Conventional Commits since the last release, bumps `package.json` (and the lockfile), commits it as `chore(release): v<x>`, cuts the GitLab release, and creates the git tag.
   It never publishes: `@semantic-release/npm` is configured with `npmPublish: false`.

**Tag pipeline** — created by `semantic-release`:

4. `compliance` — `oss-compliance-check` runs again; its first rule is `$CI_COMMIT_TAG`, so FOSSA checks the exact tag.
   This is the gate: a failing license check fails the stage and `publish-npm` never starts.
5. `release-package` — `publish-npm`: `npm ci`, `npm run build`, `npm publish`.

`compile-typescript` and `semantic-release` skip `chore(release):` commits, so the release commit's own branch pipeline is a no-op.

## Publishing without a token

The publish target is public npmjs, authenticated by OIDC trusted publishing — there is no `NPM_TOKEN`.
`publish-npm` mints an `NPM_ID_TOKEN` (audience `npm:registry.npmjs.org`) and a `SIGSTORE_ID_TOKEN` for provenance, and npmjs trades those for publish rights.

Two prerequisites:

- **npmjs trusted publisher.** `@quantum-hub/relay` must have a trusted publisher configured on npmjs pointing at this GitLab project and the `publish-npm` job.
  This is a one-time console step and has to be done before the first tag pipeline, otherwise `npm publish` fails with a 403.
- **npm >= 11.5.** Trusted publishing needs it.
  Verified 2026-07: the component's `image: node:lts` resolves to Node v24.18.0 with npm 11.16.0, so no image override is needed.

The `@quantum-hub` scope publishes publicly via `publishConfig.access: "public"` in `package.json`.
