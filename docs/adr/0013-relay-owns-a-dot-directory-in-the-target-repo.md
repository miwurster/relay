# 0013. relay owns a dot-directory in the target repo

- **Status:** accepted, amended by [ADR-0014](0014-credentials-live-in-the-target-repo-gitignored.md)
- **Date:** 2026-07-27
- **Updated:** 2026-07-28 — see [Update](#update-2026-07-28)

## Context and Problem Statement

relay asks a target repo to commit two files: a config and a **sandbox recipe**.
It put them at `relay.config.ts` and `docker/relay.Dockerfile`.

The second of those is a squat.
`docker/` is where a repo keeps its own images and its compose stack, and relay's recipe is not one of those — it is relay's build of relay's sandbox, and only relay ever reads it.
`resolveDockerfile` says so itself: it refuses a recipe at the repo root because "the sandbox recipe is relay's concern living in the repo, not the repo's own application image", and then the default dropped that concern into the repo's docker directory.
A repo with a `docker/` of its own gets a foreign file in it; a repo without one gets a `docker/` it never wanted, holding one file that has nothing to do with Docker as the repo practises it.

The root config is the same shape of problem in a namespace that tolerates it better.
The repo root is a commons — `relay.config.ts` sits next to `vite.config.ts` and `eslint.config.ts` and reads as one of them.
But it left relay's two files in two unrelated places, which is what made the recipe's home look defensible.

## Decision Drivers

- relay is a guest in the target repo's namespaces, the same principle already applied to its labels ([ADR-0011](0011-init-creates-the-label-vocabulary.md)).
- A path a repo commits is expensive to change once anyone has adopted it, so it is worth getting right before the first release.
- An operator should be able to see at a glance which files in their repo belong to relay.
- The recipe and the config are one tool's setup, and split homes obscure that.

## Considered Options

- **Option A** — one relay-owned dot-directory, `.relay/`, holding both files.
- **Option B** — move the recipe only, to `.relay/Dockerfile`, and leave the config at the root.
- **Option C** — a visible `relay/` directory instead of a dotted one.
- **Option D** — keep both paths and document that `docker/relay.Dockerfile` is relay's.

## Decision Outcome

Chosen option: **Option A**.

```
.relay/
├── config.ts
└── Dockerfile
```

Both are committed.
`RELAY_DIR` states the directory once and `CONFIG_FILE_PATH` and `DEFAULT_DOCKERFILE_PATH` compose from it, so the two paths cannot drift apart.

**The directory carries the name, so the files don't.**
Inside `.relay/`, a file called `relay.config.ts` stutters and earns nothing.
`Dockerfile` is also the name every editor and every reader already knows, which `relay.Dockerfile` only approximated.

**Dotted, not visible.**
`.github/` and `.devcontainer/` are the precedent: a tool's committed configuration, kept out of the way of the repo's own top-level shape.
Option C was rejected for trading a shared namespace squat for a visible one — `relay/` at the top level of someone's repo reads like a source directory.

**The root ban stays.**
`resolveDockerfile` still refuses a `dockerfile` path at the repo root, since a repo can still point the setting at its own application image. Its example string now names `.relay/Dockerfile`.

**Ignored scratch stays out.**
A pass's git worktree remains at `.sandcastle/worktrees/`, sandcastle's own path and gitignored.
Pulling it into `.relay/` would mix committed files and ignored scratch in one directory, which is worse than the split it would fix.

**No migration.**
The defaults flip with no fallback lookup and no deprecation path.
relay has never been published and carries no tags, so the old paths were never anyone's.

### Consequences

- Good: nothing of relay's lands in a namespace the repo owns, and everything of relay's that the repo commits is in one place an operator can see.
- Good: relay's two setup files can never disagree about where they live.
- Bad: TypeScript wildcard `include` globs skip dot-directories, so a repo that typechecks its root `relay.config.ts` today loses that coverage. A malformed config surfaces at relay runtime as a `ConfigError` (exit 2) rather than in the repo's own **green gate**. `relay doctor`'s config check is the deliberate answer to this.
- Bad: a config file outside the repo root runs against the JavaScript ecosystem's convention, so an operator looking for relay's settings will look at the root first.

## Update 2026-07-28

`.relay/` is no longer committed-only.
[ADR-0014](0014-credentials-live-in-the-target-repo-gitignored.md) moved relay's **credential file** to `.relay/.env`, which is never committed, alongside a committed `.relay/.env.example` and a committed `.relay/.gitignore` that carries the `.env` entry.
So the directory now holds four committed files and one ignored one.

**Ignored scratch stays out** above refused precisely this mixing, and the distinction that survives is *generated scratch* versus *an operator's own file*.
A pass's worktree is scratch relay produces on every run, and interleaving it with committed setup would make the directory unreadable — that reasoning is untouched, and the worktree stays at `.sandcastle/worktrees/`.
The credential file is neither generated nor scratch: it is one file the operator writes once, and it is the untracked half of a `.env` / `.env.example` pair whose two halves are only legible next to each other.

`RELAY_DIR` still states the directory once, and `CREDENTIAL_FILE_PATH`, `CREDENTIAL_EXAMPLE_FILE_PATH` and `RELAY_GITIGNORE_PATH` compose from it like the original two paths do.

The good consequence above — *"everything of relay's that the repo commits is in one place an operator can see"* — needs one word added: everything of relay's is in one place, and exactly one thing there is not committed.
