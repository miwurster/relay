# Releasing relay

`@miwurster/relay` is built and published by `.github/workflows/ci.yml`.
Everything is a single package at the repo root, and the whole pipeline is that one file.

## What runs when

**Pull request** — the `verify` job only:

1. `npm ci`, then `npm run verify`, then `npm run build`.
   `npm run verify` is `lint` plus `test`, and `lint` runs `typecheck`, `lint:code` (ESLint) and `lint:format` (Prettier).
   It is the same command you run locally, so a green gate on your machine means a green gate in CI.
   `npm run build` follows because `tsup` bundles with esbuild and can fail on its own, long after `tsc` was happy.

**Push to `main`** — `verify` as above, then `release`:

2. `npm ci`, `npm run build`, then `semantic-release`.
   It reads the Conventional Commits since the last tag, cuts the git tag and the GitHub release, and publishes the package to npm.

The `release` job never runs on a pull request: it is guarded by both a push-only trigger and `if: github.ref == 'refs/heads/main'`.
It also takes a `concurrency` group, so two pushes to `main` in quick succession queue instead of racing on the same tag.

`npm run build` runs explicitly before `semantic-release` because `package.json` has no `prepack` script and `files` ships only `dist`.
Without that step the tarball would publish without a binary.

## The version in `package.json` is a dead number

relay does not commit the version bump back to `main`.
There is no `@semantic-release/git` in `.releaserc.json`, so nothing in the repository is rewritten by a release.

That means `package.json`'s `version` is stale by design and will drift further with every release.
**Git tags and the npm registry are the only truth about what has been released.**
The published tarball always carries the right version — `@semantic-release/npm` bumps it in the workspace before packing — but the number you read in the repository is not it.

Do not "fix" the version in `package.json`, and do not read it to find out what is released.
Use `git tag --list` or `npm view @miwurster/relay version`.

## Publishing without a token

The publish target is public npmjs, authenticated by OIDC trusted publishing — there is no `NPM_TOKEN`.
The `release` job declares `id-token: write`, npm exchanges that token for publish rights, and provenance attestations are generated automatically.
Do not add `--provenance`, and do not set `registry-url` on `actions/setup-node`: it writes an `.npmrc` that breaks semantic-release's auth.

Two prerequisites:

- **npmjs trusted publisher.** `@miwurster/relay` must have a trusted publisher configured on npmjs pointing at the `miwurster/relay` repository and the `ci.yml` workflow.
  A package can have only one trusted publisher at a time, and it is bound to that exact workflow filename — renaming `ci.yml` breaks publishing until someone edits the npmjs console.
  npm also requires the package to exist before a trusted publisher can be attached to it, so the very first version is published by hand.
- **npm >= 11.5.1**, which needs Node >= 22.14.
  The workflow pins `node-version: 24`, whose bundled npm satisfies this.

The scope publishes publicly via `publishConfig.access: "public"` in `package.json`.

## Pinning

`cycjimmy/semantic-release-action@v6` floats on its major branch, and `semantic_version: 25` floats within the semantic-release major.
Both are deliberate, and both mean the publish path can change without a commit in this repository.
The action installs semantic-release into its own directory, so this repository's lockfile does not pin it.

## Predecessor

relay was previously published as `@quantum-hub/relay` from GitLab CI, with a FOSSA compliance gate and a separate tag pipeline that did the publishing.
That package is frozen at `1.0.0` and receives no further releases.
