# 0010. The sandbox shares the host's worktree and git directory

- **Status:** accepted
- **Date:** 2026-07-27

## Context and Problem Statement

Every **role** prompt tells its **leg** it is "running in a sandboxed worktree of this repo", and [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md) makes the shared worktree the reason **legs** cannot run concurrently.
Neither says where that worktree actually is.

The natural reading is that the **sandbox** holds a copy: files pushed into a container, isolated from the host, synced back at the end.
That is not what happens, and the difference decides how much a runaway **leg** can reach.

sandcastle cuts a real git worktree on the host at `<repo>/.sandcastle/worktrees/<branch>` and bind-mounts it into the container.
Because a linked worktree's `.git` is a file pointing at the main repository, sandcastle must also mount the host repo's whole `.git` directory for git to work inside the container at all — read-write, at the same absolute path.

So relay has to decide what it is promising, and what it accepts in exchange.

## Decision Drivers

- relay hardcodes the Docker sandbox: `src/sandbox.ts` names it directly, and nothing configures a provider.
- The host hook that initialises submodules runs on the host, in the worktree, and only works because the worktree is a real host directory.
- A **pass** already runs an autonomous agent holding a `GH_TOKEN` with write access to the repo ([ADR-0005](0005-secrets-travel-with-the-machine.md)).
- A promise the docs make has to be one the code keeps, or the next reader is misled about their own machine.

## Considered Options

- **Option A** — Guarantee the bind-mounted host worktree, accept the host `.git` mount, and document both.
- **Option B** — Keep the docs provider-agnostic, so relay stays portable to an isolated sandbox provider later.
- **Option C** — Guarantee the shared worktree, but close the host `.git` hole with a narrower mount.

## Decision Outcome

Chosen option: **Option A**.

Concretely:

- The **sandbox**'s worktree is a real directory on the host, bind-mounted, not a copy. Writes inside the container land on host disk immediately.
- The host repository's entire `.git` directory is mounted read-write into the container. A **leg** can therefore reach refs, objects, config and hooks belonging to the whole repo, not just the **pass branch**.
- relay is Docker-only. An isolated provider, where files are synced rather than shared, is not a supported configuration.

The `.git` mount is a real escape path: a **leg** that writes `.git/hooks/post-checkout` gets it executed on the host the next time a human runs git there.
It is accepted rather than closed because the `GH_TOKEN` a **pass** already carries is a strictly larger blast radius, and because the mount is sandcastle's, not relay's — narrowing it means owning a fork of its mount logic to buy back less than the token already spends.

### Consequences

- Good: the role prompts are literally true, and ADR-0002's shared-worktree constraint rests on a stated guarantee rather than an accident.
- Good: host-side git commits are the **pass**'s durable output with no sync step to fail, which is what [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md)'s recovery story assumes.
- Bad: the **sandbox** isolates process, network and tooling — not host git state. Operators have to know that before pointing relay at a repo.
- Bad: the worktree path is sandcastle's and not configurable, so it lands inside the repo and every repo relay runs on needs `.sandcastle/` ignored.
- Bad: moving to an isolated provider later is a real change, not a flag.

### Confirmation

`src/sandbox.ts` names the Docker sandbox directly and passes the host repo root as `cwd`.
`docs/migrating-a-repo-to-relay.md` states what the sandbox can reach on the host, so an adopter meets it before the first pass.

## Pros and Cons of the Options

### Option B — stay provider-agnostic

- Good, because a future isolated provider would need no doc rewrite.
- Bad, because the submodule host hook already assumes a host filesystem, so the portability is fictional.
- Bad, because refusing to state the guarantee leaves every reader with the wrong mental model of where their files are.

### Option C — narrow the `.git` mount

- Good, because it removes a genuine host escape path.
- Bad, because it means forking sandcastle's mount resolution and keeping it correct across releases.
- Bad, because it closes the smaller hole while the `GH_TOKEN` stays open, which is security theatre.

## More Information

- Provenance: grilling of 2026-07-27.
- Related: [ADR-0002](0002-one-sandbox-one-branch-sequential-legs.md), [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md), [ADR-0005](0005-secrets-travel-with-the-machine.md)
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
