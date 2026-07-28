# 0014. Credentials live in the target repo, gitignored

- **Status:** accepted
- **Date:** 2026-07-28

## Context and Problem Statement

[ADR-0005](0005-secrets-travel-with-the-machine.md) put relay's secrets in a home-directory file at `$XDG_CONFIG_HOME/relay/.env`, and `secrets.ts` said so in as many words: *"No secret ever ships in the package, and nothing is read from the target repo."*
One file, one machine, every repo.

That is the wrong grain for how relay is actually run.
An operator points relay at several repos, and those repos do not share a token: a fine-grained GitHub token is scoped to one repo by design ([`docs/setup.md`](../setup.md) asks for exactly that), so one home-directory `GH_TOKEN` is either scoped to one repo and broken for the rest, or broad enough to reach all of them and far past what any single **pass** needs.
The **credential file** has to be per-repo for a per-repo token to mean anything.

The obvious per-repo home is the **relay directory** — but ADR-0005 considered and rejected exactly that shape, and did so bluntly: putting secrets in the repo config was *"disqualifying on its own"* because it *"puts secrets in a git repository."*
[ADR-0013](0013-relay-owns-a-dot-directory-in-the-target-repo.md) then made `.relay/` a committed-only directory and refused to mix committed files with ignored ones in it.

So the question is whether a secret can live in the repo *directory* without living in the repo's *git history*, and whether that is worth the two ADRs it contradicts.

## Decision Drivers

- A per-repo token is the whole point of a fine-grained token, so relay's credential resolution has to be per-repo too.
- No secret may be committed to a target repo or ship in the published package.
- CI and one-off runs must keep working without any file at all — an ADR-0005 driver that has nothing to do with where the file lives.
- An operator should be able to see which files in their repo belong to relay, which is what ADR-0013 bought.
- Whatever protects the credential file has to protect every clone, not just the machine that ran `init`.

## Considered Options

- **Option A** — `.relay/.env` replaces the home-directory file outright, gitignored by a committed `.relay/.gitignore`, with an `.env.example` beside it.
- **Option B** — `.relay/.env` layered *over* the home-directory file, repo winning, home as fallback.
- **Option C** — keep the home-directory file only, and accept one broad token per machine.
- **Option D** — `.relay/.env` gitignored by a line appended to the repo's root `.gitignore` rather than a nested one.

## Decision Outcome

Chosen option: **Option A**.

```
.relay/
├── config.ts      committed
├── Dockerfile     committed
├── .env.example   committed
├── .gitignore     committed — carries `.env`
└── .env           never committed
```

**In the repo directory, never in git.**
This is the whole answer to ADR-0005's Option B rejection, and it is worth being precise about, because ADR-0005 was right about the thing it was refusing.
What is disqualifying is a secret in a repo's *history*, reachable by anyone who clones it.
A gitignored file in a working directory is not that: it is the same class of object as the home-directory file, a token on one operator's disk, moved to a path that lets it be scoped to one repo.
The property ADR-0005 was protecting — no secret committed, no secret shipped — holds unchanged.

**The ignore rule is committed, and lives in relay's own directory.**
`.relay/.gitignore` carrying `.env`, not a line in the repo's root `.gitignore` (Option D).
Committed, so the rule protects every clone and every teammate rather than the one machine that happened to run `init`; nested, so relay stays inside its own namespace instead of appending to a file the repo owns, which is the guest principle ADR-0013 was built on.
It also puts the rule next to the file it protects, so the two cannot drift apart.

**`init` writes the example, never the credential file.**
A file relay created and left empty is indistinguishable from one an operator filled in and got wrong, so `init` writes `.relay/.env.example` and names copying it as one of the steps that remain a human's.
The example is kept, never overwritten, like every other file `init` writes.

**`doctor` fails a repo whose git does not ignore the credential file.**
Unconditionally, and whether or not the file exists yet — mirroring the `worktree ignored` check, and for the same reason: a repo set up before `init` wrote the rule never got one, and the failure is worth having before the dangerous file is on disk rather than after.
The question is asked of `git check-ignore` rather than matched against text, because the rule may come from relay's `.gitignore`, the repo's own, a negation, or the operator's global excludes file.
That also catches a `.relay/.env` that is *already tracked* — git reports a tracked path as not ignored, since ignore rules do not apply to it — which is the case that actually leaks.

**Environment variables still win.**
Unchanged from ADR-0005, and load-bearing: a CI checkout has no credential file and must not need one.
`doctor`'s `secrets` check reports which variables resolved and from which of the two places, names only and never values, so an operator who filled the file in and sees `the environment` learns that their shell is winning before they go hunting for a typo.

**No presence check.**
`doctor` does not check whether `.relay/.env` exists, because with environment variables winning, a CI run with no file is a correct setup.
The question worth answering is *are my credentials being picked up, and from where*, which the provenance line answers — and which a present-but-empty file would have passed.

**One file, no fallback.**
Option B's layering was rejected: two credential files with a precedence order between them is a third place for a stale token to hide, and the per-machine convenience it preserves is the thing this ADR is deliberately trading away.
`$XDG_CONFIG_HOME/relay/.env` is not read, and there is no deprecation path — relay has never been published, so the old path was never anyone's.

### Consequences

- Good: a repo's token can be scoped to that repo, which is what a fine-grained token is for.
- Good: the blast radius of a leaked credential file is one repo rather than every repo on the machine.
- Good: the ignore rule ships with the repo, so a teammate who clones it is protected without running anything.
- Good: `doctor` refuses to run past a credential file git can see, including one already committed.
- Bad: an operator with several repos now sets each one up, where before one home-directory file served all of them. This is the cost of the per-repo scoping and is accepted, not mitigated.
- Bad: a secret now sits inside the repo working directory, so an operator who deletes `.relay/.gitignore`, or forces an add, can commit a token. `doctor` is the guard, and it is a check rather than an impossibility.
- Bad: `.relay/` is no longer committed-only, which was a rule ADR-0013 stated. See its update.
- Bad: a `.relay/.env` copied along with a repo directory — an archive, a `cp -r`, a backup that does not respect gitignore — carries the token with it, which the home-directory file never did.

### Confirmation

`tests/host/secrets.test.ts` covers resolution from the credential file, environment precedence, the single aggregated error naming the path, and that the reported sources carry variable names and no values.
`tests/host/credential-file.test.ts` covers the ignore rule and what `credentialFileIgnored` makes of git's exit code.
`tests/init/init.test.ts` covers that `init` writes the example and the nested `.gitignore`, keeps existing ones, and writes no credential file of its own.
`tests/doctor/doctor.test.ts` covers the `credentials ignored` failure and the provenance line in both places and in a mix.

## Pros and Cons of the Options

### Option B — repo file layered over the home file

- Good, because an operator who wants one token for everything keeps it, and per-repo becomes an override.
- Bad, because two files with a precedence order is one more place a stale token hides, and diagnosing "which of these two is winning" is exactly the confusion the provenance line exists to remove.

### Option C — home-directory file only

- Good, because it is the status quo and contradicts nothing.
- Bad, because it forces one token broad enough for every repo relay is pointed at, which is the opposite of what the fine-grained token in `docs/setup.md` is for.

### Option D — root `.gitignore` line

- Good, because it matches the precedent already set for `.sandcastle/`.
- Bad, because the rule then lives in a file the repo owns, away from the file it protects.
- Bad, because appending it is a per-machine act: a clone whose `init` was never run has no rule. The `.sandcastle/` line has the same weakness, but the stakes there are untracked noise rather than a published token.

## More Information

- Provenance: grilling of 2026-07-28.
- Supersedes the secrets half of [ADR-0005](0005-secrets-travel-with-the-machine.md); its repo-config half stands.
- Amends the committed-only rule in [ADR-0013](0013-relay-owns-a-dot-directory-in-the-target-repo.md).
- Domain language: [`CONTEXT.md`](../../CONTEXT.md), under **Credential file**.
