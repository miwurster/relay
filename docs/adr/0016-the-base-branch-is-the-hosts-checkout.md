# 0016. The base branch is the host's checkout

- **Status:** accepted
- **Date:** 2026-07-28

## Context and Problem Statement

One branch answers four questions in a **pass**: where the **pass branch** is cut from, what the reviewer's branch **lens** diffs against, what range **handover** reports the **tickets**' commits from, and — under `merge` **landing** ([ADR-0015](0015-a-repo-declares-how-a-pass-lands.md)) — what the work lands on.

Until now it was one configured string, `defaultBranch`, which `init` detected from `origin/HEAD` once and wrote into `relay.config.ts`.
Merge landing broke that quietly.
sandcastle merges into the host's *current* branch, and an operator standing on `spike/foo` with `defaultBranch: "main"` would get a pass cut from `main`, gated against `main`, and merged into `spike/foo` — dragging every unrelated `main` commit into the spike, and landing a result the **green gate** never saw.

So the four questions can be answered by a config value or by where the operator actually stands, and the two can disagree.

## Decision Drivers

- Merge landing makes "cut from" and "landed on" the same branch or an incoherent pair; nothing else can reconcile them.
- A config value detected once drifts from the operator's checkout for the rest of the repo's life.
- The **sandbox** already shares the host's worktree and `.git` ([ADR-0010](0010-the-sandbox-shares-the-hosts-worktree-and-git-directory.md)), so the host's checkout is a fact a pass can read rather than a thing it must be told.
- A mode-dependent answer would let a repo be correct under one **landing** and wrong under the other.

## Considered Options

- **Option A** — delete `defaultBranch`; resolve one **base branch** from the host's checkout at pass start, for both landings.
- **Option B** — keep `defaultBranch` as a fallback for when the host's HEAD is unusable.
- **Option C** — keep `defaultBranch` required, and read the host's checkout only under merge landing.

## Decision Outcome

Chosen option: **Option A**.

The harness resolves the **base branch** once, at pass start, from the host repository's current branch, and feeds that one value to the sandbox's branch cut, the reviewer's branch scope, handover's commit range, and the **lander**.
A detached or unborn HEAD is refused with exit 2 rather than falling back: there is no branch to cut from, and under merge landing nothing to fast-forward.
`defaultBranch` is removed from the config schema, so a repo that still carries it fails to load — the same one-line migration `landing` already forces, in the same file.

The rejected fallback was not free.
A detached HEAD is precisely the case relay should refuse, so `defaultBranch` would have been dead config that still read as live, and the next reader would have to work out which of the two was in force.

### Consequences

- Good: the branch a pass is cut from, reviewed against, reported against and landed on is one branch, by construction rather than by two values agreeing.
- Good: an operator changes what a pass targets by checking out a branch, which is what they were going to do anyway.
- Good: one fewer key in `relay.config.ts`, and one fewer thing `init` has to detect correctly.
- Bad: a pass's target is now ambient. Running relay from the wrong checkout targets the wrong branch, and nothing in a committed file would have caught it.
- Bad: two clones of the same repo can run passes against different base branches with identical config, so a pass is no longer reproducible from the config alone.
- Bad: every existing repo's config fails to load until `defaultBranch` is removed.

### Confirmation

`doctor` prints the resolved base branch, and fails on a detached or unborn HEAD.
A repo whose config still carries `defaultBranch` fails to load with an unknown-key error.

## Pros and Cons of the Options

### Option B — `defaultBranch` as a fallback

- Good, because a detached HEAD still resolves to something.
- Bad, because it resolves to something relay should have refused, on a branch the operator is not standing on.
- Bad, because two sources of truth remain, and which one applied is invisible after the fact.

### Option C — host checkout under merge landing only

- Good, because pull-request repos keep a config value that has worked.
- Bad, because it reintroduces the disagreement this decision exists to remove, now mode-dependent.
- Bad, because the reviewer and handover would base on different branches depending on `landing`, for no reason a reader could infer.

## More Information

- Provenance: grilling of 2026-07-28.
- Related: [ADR-0015](0015-a-repo-declares-how-a-pass-lands.md) — merge landing is why the two branches had to be one.
- Related: [ADR-0010](0010-the-sandbox-shares-the-hosts-worktree-and-git-directory.md) — the host checkout is readable because the worktree and `.git` are the host's.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
