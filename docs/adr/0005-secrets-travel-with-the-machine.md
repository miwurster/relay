# 0005. Secrets travel with the machine; repo config travels with the repo

- **Status:** accepted, secrets half superseded by [ADR-0014](0014-credentials-live-in-the-target-repo-gitignored.md)
- **Date:** 2026-07-26
- **Updated:** 2026-07-27 — see [Update](#update-2026-07-27); 2026-07-28 — see [Update](#update-2026-07-28)

## Context and Problem Statement

A **pass** needs credentials: a tracker and forge token, and Claude credentials.
It also needs non-secret configuration: the **green gate** command, the default branch, and the sandbox image.

relay is published as a package and run against many repos, so where each of these lives is a real decision.
Putting them in the same place would be simpler and wrong — one of them belongs to the repo and the other to the operator's machine.

## Decision Drivers

- No secret may ship in the published package or be committed to a target repo.
- A token should exist in as few places as possible, and never on disk inside the **sandbox**.
- CI and one-off runs must be able to supply credentials without a file.

## Considered Options

- **Option A** — Secrets from a home-directory file with environment-variable override; non-secret repo configuration in the repo's own config file and **tracker doc**.
- **Option B** — Everything in the target repo's config file.
- **Option C** — Environment variables only, no file.

## Decision Outcome

Chosen option: **Option A**, because it splits the two axes cleanly: non-secret repo config travels with the repo, secrets travel with the machine.

- Secrets resolve from `$XDG_CONFIG_HOME/relay/.env`, with real environment variables taking precedence so CI and one-off runs can override.
- The typed repo config is strict and carries no secrets and no tracker identifiers, so an unknown key there is a mistake worth failing on.
- Every missing secret is reported in one error, so an operator fixes their whole setup in one go.
- The token reaches the **sandbox** as an environment variable and is never written to its disk.

One identity end to end: the same service account authenticates the host's calls and the in-sandbox ones, so all tracker attribution is relay's.
This reverses an earlier spike position that the tracker token would never enter the container — deliberate, because the tracker-facing **roles** now talk to the tracker themselves.

### Consequences

- Good: no secret can be committed to a target repo or shipped in the package.
- Good: the token never lands on disk inside the **sandbox**.
- Good: an operator sets their machine up once, and every repo works.
- Bad: the tracker token now enters the container, which is strictly more exposure than the host-only arrangement it replaced.
- Bad: every tracker action is attributed to the service account, so who triggered a **pass** is not visible in the tracker.
- Bad: a new machine needs setup before relay works at all, which `relay doctor` exists partly to diagnose.

### Confirmation

`tests/secrets.test.ts` covers precedence, the single aggregated error, and the file format.
`relay doctor` reports the secrets check without printing any value.

## Pros and Cons of the Options

### Option B — everything in the repo config

- Good, because there is one place to look and it is version-controlled.
- Bad, because it puts secrets in a git repository, which is disqualifying on its own.

### Option C — environment variables only

- Good, because nothing is ever written to disk.
- Good, because it is the natural shape for CI.
- Bad, because an interactive operator would have to export every variable in every shell, which they will work around in ways worse than a file.

## Update 2026-07-27

The split this ADR decided still holds; what travels changed with the switch to GitHub ([ADR-0007](0007-one-forge-one-tracker-no-abstraction.md)).

- The Atlassian service-account pair and `GITLAB_TOKEN` are replaced by **one** fine-grained token, injected as `GH_TOKEN`, so `Secrets` is `{ github, claude }`. `GH_TOKEN` rather than `GITHUB_TOKEN` because `gh` prefers it and it cannot collide with the variable GitHub Actions injects.
- The mechanism is no longer REST host-side and MCP in the sandbox — it is `gh` on both sides, so the MCP config this ADR describes writing no longer exists. The property it was protecting survives: the token is in the environment, never on the sandbox's disk.
- The non-secret tracker identifiers the original context named are gone entirely: the **tracker doc** no longer carries setup constants, because a repo owns its own issues and `gh` reads the repo from the git remote ([ADR-0008](0008-the-native-github-graph-is-the-tracker-model.md)). Repo config still travels with the repo — it is now the green gate, branch and image only.

The bad consequences above stand unchanged, and the second one gets worse in one respect: a single token now carries both tracker and forge write access, so its blast radius is larger than the pair it replaced.

## Update 2026-07-28

The secrets half of this decision is superseded by [ADR-0014](0014-credentials-live-in-the-target-repo-gitignored.md).
Secrets no longer travel with the machine: they resolve from `.relay/.env` in the target repo, gitignored by a committed `.relay/.gitignore`, and `$XDG_CONFIG_HOME/relay/.env` is not read at all.
The reason is that a fine-grained GitHub token is scoped to one repo, so one home-directory token is either broken for every other repo or broader than any single pass needs.

Two things this ADR decided survive intact and are still the live rules:

- **Repo config travels with the repo.** The typed config is still strict, still carries no secret and no tracker identifier.
- **Real environment variables win over the file.** Still true, and still for the reason given here — CI and one-off runs must work with no file at all.

The Option B rejection above still reads as a refusal of what ADR-0014 does, so it is worth saying exactly what changed.
Option B put secrets in the repo's *committed config*; ADR-0014 puts them in a *gitignored file* in the repo's working directory.
No secret is committed and none ships in the package, which is the property this ADR was protecting.

One consequence here is inverted: *"an operator sets their machine up once, and every repo works"* is no longer true, and the per-repo setup cost is now accepted deliberately as the price of per-repo token scoping.
The `tests/secrets.test.ts` named under Confirmation is now `tests/host/secrets.test.ts`.

## More Information

- Provenance: `.scratch/relay-npx-tool/issues/04-credential-and-secrets-flow.md`, grilling of 2026-07-23; updated per `.scratch/github-switch/decisions.md`, grilling of 2026-07-26; secrets half superseded per grilling of 2026-07-28.
- Related: [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md), [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md), [ADR-0014](0014-credentials-live-in-the-target-repo-gitignored.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
