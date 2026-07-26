# 0005. Secrets travel with the machine; repo config travels with the repo

- **Status:** accepted
- **Date:** 2026-07-26

## Context and Problem Statement

A **pass** needs credentials: a tracker service account, a GitLab token, and Claude credentials.
It also needs non-secret identifiers: the tracker project key and this repo's label.

relay is published as a package and run against many repos, so where each of these lives is a real decision.
Putting them in the same place would be simpler and wrong — one of them belongs to the repo and the other to the operator's machine.

## Decision Drivers

- No secret may ship in the published package or be committed to a target repo.
- A token should exist in as few places as possible, and never on disk inside the **sandbox**.
- CI and one-off runs must be able to supply credentials without a file.

## Considered Options

- **Option A** — Secrets from a home-directory file with environment-variable override; non-secret tracker identifiers in the repo's **tracker doc**.
- **Option B** — Everything in the target repo's config file.
- **Option C** — Environment variables only, no file.

## Decision Outcome

Chosen option: **Option A**, because it splits the two axes cleanly: non-secret repo config travels with the repo, secrets travel with the machine.

- Secrets resolve from `$XDG_CONFIG_HOME/relay/.env`, with real environment variables taking precedence so CI and one-off runs can override.
- The typed repo config is strict and carries no secrets and no tracker identifiers, so an unknown key there is a mistake worth failing on.
- Every missing secret is reported in one error, so an operator fixes their whole setup in one go.
- The Atlassian MCP config written for the sandbox references the bearer as `${ATLASSIAN_SA_TOKEN}` rather than writing the token out, so the token lives in the sandbox's environment and never on its disk.

One identity end to end: the same service account authenticates the host's REST call and the in-sandbox MCP server, so all tracker attribution is relay's.
This reverses an earlier spike position that the tracker token would never enter the container — deliberate, because the tracker-facing **roles** now talk to the tracker themselves over MCP.

### Consequences

- Good: no secret can be committed to a target repo or shipped in the package.
- Good: the MCP bearer never lands on disk inside the **sandbox**.
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
- Bad, because an interactive operator would have to export four variables in every shell, which they will work around in ways worse than a file.

## More Information

- Provenance: `.scratch/relay-npx-tool/issues/04-credential-and-secrets-flow.md`, grilling of 2026-07-23.
- Related: [ADR-0004](0004-skills-are-mounted-not-baked-into-the-image.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
