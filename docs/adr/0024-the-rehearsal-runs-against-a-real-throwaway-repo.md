# 0024. The rehearsal runs against a real throwaway repo

- **Status:** accepted
- **Date:** 2026-07-30

## Context and Problem Statement

relay's tests cover every **leg** against stubbed **crews**, and the **sandbox probe** covers the container contract against a fixture repo.
Neither answers the question a contributor actually has after changing a prompt, a **role**'s model or the harness's topology: *does the flow feel better now?*

That question needs a whole **pass** — selection, plan, implement, review, fix, gate, land, handover — over a **work item** whose text does not change between runs, cheap enough to run repeatedly.

relay speaks GitHub and only GitHub ([ADR-0007](0007-one-forge-one-tracker-no-abstraction.md)), and its **legs** read the tracker themselves, with `gh`, from inside the **sandbox** ([ADR-0018](0018-legs-read-the-tracker-themselves.md)).
So there is no tracker seam to substitute at: `createGitHubClient` is one caller of `gh` among many, and the ones that matter most are inside the sandbox, in a **cold session** relay does not hold a handle to.

The question this ADR settles is what a **rehearsal** runs against.

## Decision Drivers

- What is being judged is the roles' behaviour against a real tracker graph — sub-issues, labels, blockers, a PR or a close. A rig that fakes those judges the fake.
- Legs call `gh` from inside the sandbox, so faking the tracker means putting a fake `gh` on the sandbox's PATH — relay's own code would no longer be the thing under rehearsal.
- The rig must be re-runnable without thought. If getting back to a known start is manual, it will be skipped or done wrong, and the two runs being compared will not be comparable.
- Seeding a **scenario** means deleting every issue and force-pushing `main`. Pointed at a repo anyone works in, that is unrecoverable.
- `AGENTS.md`: no abstraction for single-use code. A tracker port introduced for a test rig is exactly that.
- A rehearsal costs real Claude sessions either way. The tracker is not where its cost lives.

## Considered Options

- **Option A** — A real throwaway GitHub repo, seeded destructively before each rehearsal.
- **Option B** — A fake `gh` on the host's and the sandbox's PATH, backed by a JSON fixture.
- **Option C** — Hybrid: a bare local repo as the git remote, real GitHub for issues only.

## Decision Outcome

Chosen option: **Option A**.

- The **rehearsal** owns one private repo, `miwurster/relay-rehearsal`, holding both the fixture app and the issues — the same-repo shape relay requires of any target.
- The repo's genesis state lives in *this* repo, at `fixtures/todo-app/`, beside the sandbox probe's fixture. The seed force-pushes it as a single commit, so the fixture is versioned with the relay changes it exists to judge and is visible in a relay diff.
- The seed bootstraps the repo when it is absent — create, push genesis, run **init** for the label vocabulary ([ADR-0011](0011-init-creates-the-label-vocabulary.md)) — and checks it otherwise.
- A **scenario** is reached by deleting every issue and creating the set fresh, rather than by editing issues back to canonical. GitHub never reuses an issue number, so a fixed set means fixed *content*, and the seed emits the numbers it made. Editing back would mean the seed remembering every field a pass mutates, and one forgotten `agent-in-progress` contaminates the next run.
- The destructive seed is guarded by a hardcoded slug: it reads the clone's `origin` and refuses unless it matches exactly. There is no env-var or flag override, because an override is the thing that would let a mistake through.
- The clone is the rig's, at a fixed path whose basename is the repo's, so the sandbox image tag is stable and its build caches between runs. The seed resets it: fetch, `reset --hard` to genesis, prune stale **pass branches** and the worktrees a crashed pass left, and delete the pass branches a previous pass pushed — which closes any pull request still open against them, since GitHub closes a pull request whose head branch is deleted.
- The rehearsal's **landing** is an argument beside the scenario's name, required and with no default, exactly as [ADR-0015](0015-a-repo-declares-how-a-pass-lands.md) requires of a repo. A `merge` rehearsal exercises the **lander** and all eight roles; a `pull-request` one exercises the **handover**'s publishing path and leaves a pull request whose diff a human can read in GitHub's own review interface, which is what that landing is rehearsed for.
- The landing is not part of a **scenario**. A scenario is a tracker state, so folding the landing into it would make every future scenario two entries sharing one body. Instead the seed *writes* `.relay/config.ts` into genesis with the chosen landing, rather than genesis committing one — the same shape the sandbox recipe already uses, except the config is not ignored, because a repo running relay commits it and genesis should have the shape relay demands of a target.
- Credentials are the ambient environment, as relay's own dogfooding already is. The token needs issue-delete rights on this one repo.
- The rehearsal is hand-run and outside `npm run verify`, for the sandbox probe's reason and one more: a green gate that spends Claude sessions and mutates a GitHub repo is not a gate.

Option B was refused rather than deferred.
The moment the sandbox's `gh` is a fake, the thing being rehearsed is the fake's fidelity, and nothing about the roles' judgement against a real graph is learned.

### Consequences

- Good: every tracker-facing rule is exercised as shipped — **eligibility check**, the sub-issue graph, the label vocabulary, the **handover** comment, the close.
- Good: no tracker port, no injected client, no fake `gh`. Zero production code exists for the rig's sake.
- Good: the fixture and the scenarios are reviewable in a relay pull request, because they are files in this repo.
- Bad: a rehearsal needs network, a GitHub token with delete rights, and a repo that exists. It cannot be run offline, and it will rot unless someone runs it — the same honest cost the sandbox probe pays.
- Bad: the seed is destructive by design. The slug guard is the whole protection, and it protects only against the wrong *clone*, not against someone renaming a real repo onto the slug.
- Bad: issue numbers drift upward run over run, so nothing may hardcode `1`. The seed's emitted numbers are the only source.
- Bad: a `pull-request` rehearsal's own artefact — the pull request it exists to produce — is deleted by the next seed. Read it before rehearsing again. The alternative is a seed that leaves state behind, which is the thing this ADR refuses.
- Bad: two rehearsals are never byte-identical, because **legs** are not deterministic. A digest diff is evidence, not proof, and reading it as proof is the misuse this rig invites.
- Reversible on purpose for scenarios, not for the tracker. Adding a scenario is a file; substituting the tracker would mean revisiting this decision and ADR-0018 together.

### Confirmation

`rehearsal/README.md` states the slug, the destructive seed and what the rig does not prove, so nobody reads a green rehearsal as a passing test.

The seed's refusal on a mismatched `origin` is the one part of the rig whose *guard* has a unit test, in `tests/` like any other: it is the guard on an unrecoverable action, and it must not be first exercised by being pointed at the wrong repo.
The scenario and landing lookups are tested for the same reason once removed — each is what stands between a mistyped argument and that seed running at all.

That the rig itself works is confirmed by running it — `npm run rehearse -- happy-path merge` and `npm run rehearse -- happy-path pull-request` — which is what it is for.

## More Information

- Provenance: the grilling of 2026-07-30 on a repeatable way to feel out changes to the flow.
- Related: [ADR-0007](0007-one-forge-one-tracker-no-abstraction.md) — why there is no tracker to substitute.
- Related: [ADR-0018](0018-legs-read-the-tracker-themselves.md) — why the calls that matter are inside the sandbox.
- Related: [ADR-0003](0003-a-crashed-pass-leaves-the-work-for-a-human.md) — why the seed must prune what a crashed pass left.
- Related: [ADR-0011](0011-init-creates-the-label-vocabulary.md) — what the seed runs on a virgin repo.
- Domain language: [`CONTEXT.md`](../../CONTEXT.md)
